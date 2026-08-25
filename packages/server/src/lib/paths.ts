import path from "node:path";
import { mkdir } from "node:fs/promises";

import { env } from "../env.ts";

const DATA_DIR = env.DATA_DIR;

// Every Python worker is spawned by path, and those paths used to be found by walking up from
// whichever file did the spawning — which stops working the moment the server is not laid out
// like the repo. One setting instead of eight relative walks.
export function scriptPath(name: string): string {
  return path.resolve(env.SCRIPTS_DIR, name);
}

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
