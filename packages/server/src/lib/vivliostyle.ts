import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

function resolveCliBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@vivliostyle/cli/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { bin: Record<string, string> };
  return path.join(path.dirname(pkgPath), pkg.bin.vivliostyle);
}

// Vivliostyle fetches its own browser on first use, into this cache. Knowing whether it is there
// is what lets the UI say "345 MB first" instead of appearing to hang for the length of a download.
const BROWSER_CACHE = path.join(homedir(), "Library", "Caches", "vivliostyle", "browsers", "chrome");

export async function rendererInstalled(dir = BROWSER_CACHE): Promise<boolean> {
  return readdir(dir).then((entries) => entries.length > 0).catch(() => false);
}

// Rendering one paragraph is the only way to make the CLI fetch its browser: there is no install
// subcommand, and the download happens solely as a side effect of a build.
export async function installRenderer(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "vivliostyle-install-"));
  try {
    const htmlPath = path.join(dir, "probe.html");
    await writeFile(htmlPath, "<!doctype html><title>.</title><p>.</p>", "utf-8");
    await buildDocument(htmlPath, path.join(dir, "probe.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function buildDocument(htmlPath: string, outputPath: string): Promise<void> {
  const bin = resolveCliBin();
  try {
    await execFileAsync(process.execPath, [bin, "build", htmlPath, "-o", outputPath, "--log-level", "silent", "--timeout", "1800"], {
      timeout: 30 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(stderr ? `${message}\n${stderr.slice(-2000)}` : message, { cause: err });
  }
}
