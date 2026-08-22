import path from "node:path";
import { mkdir } from "node:fs/promises";

import { env } from "../env.ts";

const DATA_DIR = env.DATA_DIR;

export const uploadsDir = path.resolve(DATA_DIR, "uploads");
export const tmpDir = path.resolve(DATA_DIR, "tmp");
export const outputDir = path.resolve(DATA_DIR, "output");
export const previewsDir = path.resolve(DATA_DIR, "previews");
export const pocketVoicesDir = path.resolve(DATA_DIR, "pocket-voices");

export async function ensureDataDirs() {
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(previewsDir, { recursive: true });
  await mkdir(pocketVoicesDir, { recursive: true });
}

export function bookOutputDir(bookId: string) {
  return path.join(outputDir, bookId);
}

export function bookTmpDir(bookId: string) {
  return path.join(tmpDir, bookId);
}
