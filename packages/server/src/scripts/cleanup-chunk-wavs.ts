import { eq } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { db } from "../db.ts";
import { books, chapters, chapterVariants } from "../schema.ts";
import { bookOutputDir } from "../lib/paths.ts";
import { chapterChunkPreviewDir } from "../lib/chunk-previews.ts";
import { translationChunkPreviewDir, languageSlug } from "../workers/synthesize-translation.ts";
import { measureDirs, removeDirs } from "../lib/disk-usage.ts";
import { ensureSyncMap, readSyncMap } from "../lib/sync-map.ts";
import { appendLog } from "../lib/log.ts";

const apply = process.argv.includes("--apply");
const CH_DIR_PATTERN = /^ch(\d{3})$/;

const allBooks = await db.select({ id: books.id, title: books.title }).from(books);

let totalBytes = 0;
let syncMapsBuilt = 0;

for (const book of allBooks) {
  const chapterRows = await db
    .select({ index: chapters.index, status: chapters.status, audioPath: chapters.audioPath, durationMs: chapters.durationMs })
    .from(chapters)
    .where(eq(chapters.bookId, book.id));
  const variantRows = await db
    .select({ key: chapterVariants.key, audioStatus: chapterVariants.audioStatus, audioPath: chapterVariants.audioPath, durationMs: chapterVariants.audioDurationMs, index: chapters.index })
    .from(chapterVariants)
    .innerJoin(chapters, eq(chapterVariants.chapterId, chapters.id))
    .where(eq(chapters.bookId, book.id));

  const chunksRoot = path.join(bookOutputDir(book.id), "chunks");
  const entries = await readdir(chunksRoot, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) continue;

  // Timings must be persisted before chunk WAVs go — read-along exports rebuild from them
  for (const ch of chapterRows) {
    if (ch.status !== "done" || !ch.audioPath || !ch.durationMs) continue;
    if (await readSyncMap(ch.audioPath)) continue;
    const built = await ensureSyncMap(ch.audioPath, chapterChunkPreviewDir(book.id, ch.index), ch.durationMs);
    if (built) syncMapsBuilt++;
  }
  for (const v of variantRows) {
    if (v.audioStatus !== "done" || !v.audioPath || !v.durationMs) continue;
    if (await readSyncMap(v.audioPath)) continue;
    const built = await ensureSyncMap(v.audioPath, translationChunkPreviewDir(book.id, v.key, v.index), v.durationMs);
    if (built) syncMapsBuilt++;
  }

  const chapterByIndex = new Map(chapterRows.map((ch) => [ch.index, ch]));
  const variantsBySlug = new Map<string, Map<number, (typeof variantRows)[number]>>();
  for (const v of variantRows) {
    const slug = languageSlug(v.key);
    if (!variantsBySlug.has(slug)) variantsBySlug.set(slug, new Map());
    variantsBySlug.get(slug)!.set(v.index, v);
  }

  const deletable: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(chunksRoot, entry.name);
    const chMatch = CH_DIR_PATTERN.exec(entry.name);
    if (chMatch) {
      const chapter = chapterByIndex.get(Number(chMatch[1]));
      // Missing row = leftover from an older chapter split; non-done keeps its resume chunks
      if (!chapter || chapter.status === "done") deletable.push(entryPath);
      continue;
    }
    const lane = variantsBySlug.get(entry.name);
    if (!lane) {
      deletable.push(entryPath);
      continue;
    }
    for (const sub of await readdir(entryPath, { withFileTypes: true }).catch(() => [])) {
      if (!sub.isDirectory()) continue;
      const subMatch = CH_DIR_PATTERN.exec(sub.name);
      if (!subMatch) continue;
      const variant = lane.get(Number(subMatch[1]));
      if (!variant || variant.audioStatus === "done") deletable.push(path.join(entryPath, sub.name));
    }
  }

  if (deletable.length === 0) continue;
  const bytes = apply ? await removeDirs(deletable) : await measureDirs(deletable);
  totalBytes += bytes;
  if (bytes > 0) {
    console.log(`${apply ? "freed" : "would free"} ${(bytes / 1e9).toFixed(2)} GB (${deletable.length} dirs) — ${book.title}`);
    if (apply) await appendLog(book.id, `Cleaned up WAV chunks of finished chapters — freed ${(bytes / 1e9).toFixed(2)} GB`);
  }
}

console.log(`${apply ? "freed" : "would free"} ${(totalBytes / 1e9).toFixed(2)} GB total; sync maps ensured: ${syncMapsBuilt}`);
process.exit(0);
