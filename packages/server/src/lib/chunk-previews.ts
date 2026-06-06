import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { bookOutputDir } from "./paths.ts";

export type ChunkPreview = {
  index: number;
  fileName: string;
  url: string;
  text?: string;
  start?: number;
  end?: number;
};

type ChunkManifestEntry = { index: number; text: string };

const CHUNK_FILE_PATTERN = /^chunk-(\d+)\.wav$/;
const CHUNK_MANIFEST_FILE = "chunks.json";

export function chapterChunkPreviewDir(bookId: string, chapterIndex: number): string {
  return path.join(bookOutputDir(bookId), "chunks", `ch${String(chapterIndex).padStart(3, "0")}`);
}

export function chapterChunkPreviewUrlBase(bookId: string, chapterIndex: number): string {
  return `/files/${bookId}/chunks/ch${String(chapterIndex).padStart(3, "0")}`;
}

async function readChunkManifest(dir: string): Promise<Map<number, string>> {
  try {
    const raw = await readFile(path.join(dir, CHUNK_MANIFEST_FILE), "utf-8");
    const entries = JSON.parse(raw) as ChunkManifestEntry[];
    return new Map(entries.map((entry) => [entry.index, entry.text]));
  } catch {
    return new Map();
  }
}

export async function listChapterChunkPreviews(bookId: string, chapterIndex: number): Promise<ChunkPreview[]> {
  const dir = chapterChunkPreviewDir(bookId, chapterIndex);
  const urlBase = chapterChunkPreviewUrlBase(bookId, chapterIndex);

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const manifest = await readChunkManifest(dir);

  return entries
    .map((fileName) => {
      const match = fileName.match(CHUNK_FILE_PATTERN);
      if (!match) return null;

      const index = Number(match[1]);
      const text = manifest.get(index);

      return {
        index,
        fileName,
        url: `${urlBase}/${fileName}`,
        ...(text !== undefined ? { text } : {}),
      } satisfies ChunkPreview;
    })
    .filter((entry): entry is ChunkPreview => entry !== null)
    .sort((a, b) => a.index - b.index);
}

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!inSpace) {
        norm += " ";
        map.push(i);
        inSpace = true;
      }
    } else {
      norm += text[i];
      map.push(i);
      inSpace = false;
    }
  }
  return { norm, map };
}

/**
 * Locate each chunk's character range within `sourceText`. Matching is whitespace-tolerant
 * (runs of whitespace collapse to a single space) because the chunker normalizes whitespace.
 * A running cursor ensures repeated/identical chunk texts resolve to sequential, non-overlapping
 * ranges. Returns `null` for any chunk text not found at/after the cursor.
 */
export function locateChunks(
  sourceText: string,
  chunkTexts: string[],
): Array<{ start: number; end: number } | null> {
  const { norm, map } = normalizeWithMap(sourceText);
  let cursor = 0;

  return chunkTexts.map((chunkText) => {
    const needle = chunkText.replace(/\s+/g, " ").trim();
    if (!needle) return null;

    const at = norm.indexOf(needle, cursor);
    if (at === -1) return null;

    cursor = at + needle.length;
    return { start: map[at], end: map[at + needle.length - 1] + 1 };
  });
}
