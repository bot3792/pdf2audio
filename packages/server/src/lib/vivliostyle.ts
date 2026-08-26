import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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

// Any entry is not a finished download: @puppeteer/browsers creates the version directory before
// it unpacks, so a cancelled 345 MB fetch leaves a folder that reads as installed forever — and
// with it a permanently hidden Install button and an Export PDF that always fails.
export async function rendererInstalled(dir = BROWSER_CACHE): Promise<boolean> {
  const versions = await readdir(dir).catch(() => []);
  for (const version of versions) {
    const app = path.join(dir, version, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (await stat(app).then((s) => s.isFile(), () => false)) return true;
  }
  return false;
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
