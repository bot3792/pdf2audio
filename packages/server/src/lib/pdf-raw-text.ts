import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractPdfRawText(pdfPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"], {
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const text = stdout.replace(/[ \t]+\n/g, "\n").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
