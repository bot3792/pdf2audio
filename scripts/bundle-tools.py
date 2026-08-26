#!/usr/bin/env python3
"""Copies ffmpeg, pdftotext and pdfinfo — plus every library they need — into the desktop bundle.

Homebrew's binaries link their dependencies by absolute path into /opt/homebrew, so copying one
into an app gives you something that only runs on a machine that already has Homebrew, which is
the prerequisite the app exists to remove. This walks the dependency closure, copies it, and
rewrites every load command to @loader_path so the folder runs from anywhere.

    python3 scripts/bundle-tools.py [--out packages/desktop/resources/bin]

Same lesson as the embedded Postgres, and the same reason DYLD_LIBRARY_PATH is not the answer:
the hardened runtime strips DYLD_*, so it would work in development and fail in the shipped app.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = ["ffmpeg", "pdftotext", "pdfinfo"]
SYSTEM_PREFIXES = ("/usr/lib/", "/System/")


def rpaths(binary: Path) -> list[str]:
    out = subprocess.run(["otool", "-l", str(binary)], capture_output=True, text=True).stdout
    return re.findall(r"path (\S+) \(offset", out)


def raw_deps(binary: Path) -> list[str]:
    out = subprocess.run(["otool", "-L", str(binary)], capture_output=True, text=True).stdout
    return [m.group(1) for line in out.splitlines()[1:] if (m := re.match(r"\s+(\S+)", line))]


# Homebrew's binaries reference most of their libraries as @rpath/foo.dylib rather than by absolute
# path, so a scanner that skips anything starting with "@" walks a closure of almost nothing and
# produces a folder that is missing exactly the libraries that matter.
def resolve_dep(dep: str, owner: Path) -> Path | None:
    if dep.startswith(SYSTEM_PREFIXES):
        return None
    if dep.startswith("@rpath/"):
        name = dep[len("@rpath/"):]
        for rp in rpaths(owner):
            base = rp.replace("@loader_path", str(owner.parent)).replace("@executable_path", str(owner.parent))
            candidate = Path(base) / name
            if candidate.exists():
                return candidate
        return None
    if dep.startswith("@loader_path") or dep.startswith("@executable_path"):
        candidate = Path(dep.replace("@loader_path", str(owner.parent)).replace("@executable_path", str(owner.parent)))
        return candidate if candidate.exists() else None
    p = Path(dep)
    return p if p.exists() else None


def deps(binary: Path) -> list[str]:
    return [d for d in raw_deps(binary) if not d.startswith(SYSTEM_PREFIXES)]


# Keyed by the name the load command uses, not the name on disk. libpoppler.149.dylib is a symlink
# to libpoppler.149.0.0.dylib, and copying the target while rewriting to the link's name produces a
# folder whose libraries all exist and none of which can be found.
def closure(roots: list[Path]) -> dict[str, Path]:
    found: dict[str, Path] = {}
    queue = list(roots)
    while queue:
        item = queue.pop()
        for dep in deps(item):
            name = Path(dep).name
            if name in found:
                continue
            real = resolve_dep(dep, item)
            if real is None:
                continue
            found[name] = real
            queue.append(real)
    return found


def check(args: list[str], what: str) -> None:
    if subprocess.run(args, capture_output=True).returncode != 0:
        raise SystemExit(f"{what} failed: {' '.join(args[:2])} {args[-1]}")


def relocate(path: Path, libdir_rel: str) -> None:
    ident = subprocess.run(["otool", "-D", str(path)], capture_output=True, text=True).stdout.splitlines()
    if len(ident) > 1 and ident[1].startswith("/"):
        subprocess.run(["install_name_tool", "-id", f"@rpath/{path.name}", str(path)], capture_output=True)
    for dep in deps(path):
        subprocess.run(
            ["install_name_tool", "-change", dep, f"@rpath/{Path(dep).name}", str(path)],
            capture_output=True,
        )
    subprocess.run(["install_name_tool", "-add_rpath", libdir_rel, str(path)], capture_output=True)
    # Apple Silicon refuses to run a binary whose signature does not match, and install_name_tool
    # invalidates it. Without this they are SIGKILLed with no message at all, which looks exactly
    # like a missing library and is not.
    check(["codesign", "--force", "--sign", "-", "--timestamp=none", str(path)], "re-signing")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="packages/desktop/resources/bin")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    libdir = out / "lib"
    shutil.rmtree(out, ignore_errors=True)
    libdir.mkdir(parents=True)

    originals = []
    for tool in TOOLS:
        found = shutil.which(tool)
        if not found:
            print(f"{tool} is not installed — brew install ffmpeg poppler", file=sys.stderr)
            return 1
        originals.append(Path(found).resolve())

    # Walked where they were installed: @loader_path only means anything before they move
    libs = closure(originals)
    # Without otool (no Xcode command line tools) every dependency scan comes back empty and this
    # happily produces three unrelocated binaries that work on this machine and nowhere else.
    if not libs:
        print("Resolved no libraries — is `xcode-select --install` done?", file=sys.stderr)
        return 1

    roots = []
    for original, tool in zip(originals, TOOLS):
        target = out / tool
        shutil.copy2(original, target)
        os.chmod(target, 0o755)
        roots.append(target)
    for name, real in libs.items():
        shutil.copy2(real, libdir / name)

    for lib in libdir.iterdir():
        os.chmod(lib, 0o755)
        relocate(lib, "@loader_path")
    for root in roots:
        relocate(root, "@loader_path/lib")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"{len(TOOLS)} tools + {len(libs)} libraries -> {out}  ({total / 1e6:.0f} MB)")

    # Proving it here beats discovering it on a machine with no Homebrew
    for root in roots:
        flag = "-version" if root.name == "ffmpeg" else "-v"
        r = subprocess.run([str(root), flag], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
        first = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()][:1]
        ok = bool(first) and "error" not in first[0].lower()
        print(f"  {root.name}: {'OK' if ok else 'FAILED'} {first[0][:56] if first else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
