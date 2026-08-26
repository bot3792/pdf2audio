#!/usr/bin/env python3
"""Reports which optional model bundles are cached, and fetches one on demand.

Setup used to download every model before the app could open — about 15 GB, most of it for
features a given person may never touch. This is the other half of that: the server asks what is
present, and downloads a bundle at the moment someone asks for the feature it powers.

    models.py --status                 JSON: one entry per bundle
    models.py --download <bundle-id>   fetch it (progress on stderr, from huggingface_hub)

Paths are deliberately not hardcoded on the TypeScript side: surya keeps its weights in a
platformdirs cache that differs per OS, and only Python knows where that is.
"""
import argparse
import json
import os
import sys
from pathlib import Path


def _hf_cached(repo_id: str, allow_patterns=None) -> bool:
    from huggingface_hub import snapshot_download
    try:
        path = snapshot_download(repo_id, local_files_only=True, allow_patterns=allow_patterns)
    except Exception:
        return False
    # snapshot_download returns as soon as the snapshot folder exists, which happens seconds into
    # a multi-gigabyte fetch — hub's own source says it "can't check if all the files are actually
    # there". A cancelled download would otherwise report installed, hide the download button, and
    # fail at synthesis instead, because every worker runs HF_HUB_OFFLINE=1.
    return not _has_partial_blobs(Path(path))


def _has_partial_blobs(snapshot: Path) -> bool:
    blobs = snapshot.parent.parent / "blobs"
    if any(blobs.glob("*.incomplete")):
        return True
    # A symlink into blobs/ that dangles is the other shape a half-finished fetch leaves behind
    return any(not f.exists() for f in snapshot.rglob("*") if f.is_symlink())


def _hf_fetch(repo_id: str, allow_patterns=None) -> None:
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id, allow_patterns=allow_patterns)


def _surya_dir():
    # Deliberately not `from surya.settings import settings` — that pulls in torch and turns a
    # status check the UI runs on page load into three quarters of a second. This is the same
    # platformdirs location surya computes, asserted equal against it on 2026-08-26.
    from platformdirs import user_cache_dir
    return Path(user_cache_dir("datalab")) / "models"


def marker_installed() -> bool:
    try:
        d = _surya_dir()
    except Exception:
        return False
    # The directory appears before the weights finish arriving, so an empty one is not installed
    return d.is_dir() and any(p.is_dir() and any(p.iterdir()) for p in d.iterdir())


def marker_download() -> None:
    from marker.models import create_model_dict
    create_model_dict()


BUNDLES = [
    {
        "id": "extraction",
        "label": "Marker layout and OCR",
        "unlocks": "Full extraction (Marker) and OCR — the slow, accurate path for scans and complex layouts",
        "approxMb": 5100,
        "installed": marker_installed,
        "download": marker_download,
    },
    {
        "id": "search",
        "label": "BGE-M3 embedding",
        "unlocks": "Semantic search over every book, and asking questions across the whole library",
        "approxMb": 4300,
        "installed": lambda: _hf_cached("BAAI/bge-m3"),
        "download": lambda: _hf_fetch("BAAI/bge-m3"),
    },
    {
        "id": "bulgarian",
        "label": "Bulgarian narrator",
        "unlocks": "The BG-TTS V5 and Meta MMS Bulgarian voices",
        "approxMb": 1240,
        "appleSiliconOnly": True,
        "installed": lambda: _hf_cached("raditotev/bg-tts-v5-mlx") and _hf_cached("facebook/mms-tts-bul"),
        "download": lambda: (_hf_fetch("raditotev/bg-tts-v5-mlx"), _hf_fetch("facebook/mms-tts-bul")),
    },
]

BY_ID = {b["id"]: b for b in BUNDLES}


# Developing a download gate otherwise means deleting several gigabytes to see it, and putting
# them back to see the other state. The file exists alongside the env var because the e2e suite
# drives an already-running dev server, whose environment it cannot reach. "mlx" is accepted here
# too, so the Apple-Silicon-only narrators can be seen greyed out on a machine that has MLX.
def _forced_missing() -> set:
    forced = {s for s in os.environ.get("PDF2AUDIO_MODELS_MISSING", "").split(",") if s}
    marker = Path(__file__).resolve().parent.parent / ".models-missing"
    if marker.exists():
        forced |= {line.strip() for line in marker.read_text().splitlines() if line.strip()}
    return forced


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--capabilities", action="store_true")
    parser.add_argument("--essential", action="store_true")
    parser.add_argument("--download")
    args = parser.parse_args()

    if args.download:
        bundle = BY_ID.get(args.download)
        if not bundle:
            print(f"Unknown bundle: {args.download}", file=sys.stderr)
            return 2
        bundle["download"]()
        return 0

    if args.essential:
        # Kokoro is not in BUNDLES because it is not optional — without a voice there is no
        # audiobook. It is the whole of what a first run must fetch before the app is useful.
        _hf_fetch("hexgrad/Kokoro-82M")
        return 0

    if args.capabilities:
        if _forced_missing() & {"mlx"}:
            print(json.dumps({"mlx": False}))
            return 0
        # Deliberately does not import torch to check MPS: that costs half a second and nothing
        # is gated on it — the two MLX narrators are the only engines that cannot fall back.
        try:
            import mlx.core  # noqa: F401
            mlx = True
        except Exception:
            mlx = False
        print(json.dumps({"mlx": mlx}))
        return 0

    if args.status:
        forced_missing = _forced_missing()
        out = []
        for b in BUNDLES:
            try:
                installed = b["id"] not in forced_missing and b["installed"]()
            except Exception:
                installed = False
            out.append({
                "id": b["id"],
                "label": b["label"],
                "unlocks": b["unlocks"],
                "approxMb": b["approxMb"],
                "appleSiliconOnly": b.get("appleSiliconOnly", False),
                "installed": installed,
            })
        print(json.dumps(out))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
