import path from "node:path";
import { mkdir } from "node:fs/promises";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

export const uploadsDir = path.resolve(DATA_DIR, "uploads");
export const tmpDir = path.resolve(DATA_DIR, "tmp");
export const outputDir = path.resolve(DATA_DIR, "output");

export async function ensureDataDirs() {
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
}

export function bookOutputDir(bookId: string) {
  return path.join(outputDir, bookId);
}

export function bookTmpDir(bookId: string) {
  return path.join(tmpDir, bookId);
}
