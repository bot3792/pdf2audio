import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

function resolveCliBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@vivliostyle/cli/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { bin: Record<string, string> };
  return path.join(path.dirname(pkgPath), pkg.bin.vivliostyle);
}

// First run downloads a rendering browser into the Vivliostyle cache; later runs are offline.
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
