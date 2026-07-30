import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

import { uploadsDir, bookTmpDir, bookOutputDir } from "./paths.ts";

export type BookDiskUsage = {
  uploads: number;
  extractionCache: number;
  chapterAudio: number;
  chunkWavs: number;
  assemblies: number;
  documents: number;
  other: number;
  total: number;
};

async function walk(dir: string, onFile: (filePath: string, size: number) => void): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, onFile);
    } else if (entry.isFile()) {
      const s = await stat(p).catch(() => null);
      if (s) onFile(p, s.size);
    }
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  await walk(dir, (_p, size) => {
    total += size;
  });
  return total;
}

export async function measureBookDiskUsage(
  bookId: string,
  assemblyPaths: Set<string>,
  documentPaths: Set<string>,
): Promise<BookDiskUsage> {
  const uploads = await dirSize(path.join(uploadsDir, bookId));
  const extractionCache = await dirSize(bookTmpDir(bookId));

  const outRoot = bookOutputDir(bookId);
  const chunksRoot = path.join(outRoot, "chunks") + path.sep;
  let chapterAudio = 0;
  let chunkWavs = 0;
  let assemblies = 0;
  let documents = 0;
  let other = 0;
  await walk(outRoot, (p, size) => {
    if (p.startsWith(chunksRoot)) chunkWavs += size;
    else if (assemblyPaths.has(p) || p.endsWith(".filelist.txt")) assemblies += size;
    else if (documentPaths.has(p)) documents += size;
    else if (p.endsWith(".mp3")) chapterAudio += size;
    else other += size;
  });

  const total = uploads + extractionCache + chapterAudio + chunkWavs + assemblies + documents + other;
  return { uploads, extractionCache, chapterAudio, chunkWavs, assemblies, documents, other, total };
}

export async function measureDirs(dirs: string[]): Promise<number> {
  let total = 0;
  for (const dir of dirs) {
    total += await dirSize(dir);
  }
  return total;
}

export async function removeDirs(dirs: string[]): Promise<number> {
  let freed = 0;
  for (const dir of dirs) {
    const size = await dirSize(dir);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    freed += size;
  }
  return freed;
}
