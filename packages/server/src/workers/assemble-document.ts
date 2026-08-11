import { db } from "../db.ts";
import { chapters, books, documents, chapterVariants } from "../schema.ts";
import { eq, asc, and } from "drizzle-orm";
import { renderDocumentHtml, type DocumentChapter } from "../lib/document-html.ts";
import { buildDocument } from "../lib/vivliostyle.ts";
import { bookOutputDir, bookTmpDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { languageSlug, translationChunkPreviewDir } from "./synthesize-translation.ts";
import { chapterChunkPreviewDir } from "../lib/chunk-previews.ts";
import { ensureSyncMap } from "../lib/sync-map.ts";
import { buildReadaloudEpub, type ReadaloudChapter } from "../lib/readaloud-epub.ts";
import { mkdir, writeFile, unlink, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.ts";

export type AssembleDocumentPayload = {
  bookId: string;
  language?: string;
  format: "pdf" | "epub" | "epub-sync";
  copyToDropDir?: boolean;
};

export async function assembleDocument(payload: AssembleDocumentPayload) {
  const { bookId, language, format } = payload;
  const log = (msg: string) => appendLog(bookId, msg);
  const formatLabel = format === "epub-sync" ? "synced EPUB" : format.toUpperCase();

  await db.update(books).set({ status: "assembling", updatedAt: new Date() }).where(eq(books.id, bookId));
  await log(language ? `Starting ${formatLabel} export (${language})` : `Starting ${formatLabel} export`);

  try {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    if (format === "epub-sync") {
      await assembleReadaloud(bookId, book.title, language ?? null, payload.copyToDropDir ?? false, log);
      await db.update(books).set({ status: "done", error: null, updatedAt: new Date() }).where(eq(books.id, bookId));
      await log("Synced EPUB export complete");
      return;
    }

    let docChapters: (DocumentChapter & { id: string })[];
    let selectedCount: number;

    if (language) {
      const rows = await db
        .select({
          id: chapters.id,
          index: chapters.index,
          originalTitle: chapters.title,
          customText: chapters.customText,
          cleanText: chapters.cleanText,
          rawText: chapters.rawText,
          translatedTitle: chapterVariants.title,
          translatedText: chapterVariants.text,
          translationStatus: chapterVariants.status,
        })
        .from(chapterVariants)
        .innerJoin(chapters, eq(chapterVariants.chapterId, chapters.id))
        .where(and(
          eq(chapters.bookId, bookId),
          eq(chapters.selected, true),
          eq(chapterVariants.key, language),
        ))
        .orderBy(asc(chapters.index));
      selectedCount = rows.length;
      docChapters = rows
        .filter((r) => r.translationStatus === "done" && r.translatedText.trim())
        .map((r) => ({
          index: r.index,
          title: r.translatedTitle ?? r.originalTitle,
          text: r.translatedText,
          originalTitle: r.originalTitle,
          originalText: r.customText ?? r.cleanText ?? r.rawText,
          id: r.id,
        }));
    } else {
      const selectedChapters = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.bookId, bookId), eq(chapters.selected, true)))
        .orderBy(asc(chapters.index));
      selectedCount = selectedChapters.length;
      docChapters = selectedChapters
        .map((ch) => ({
          index: ch.index,
          title: ch.title,
          text: ch.customText ?? ch.cleanText ?? ch.rawText,
          originalTitle: ch.title,
          originalText: ch.customText ?? ch.cleanText ?? ch.rawText,
          id: ch.id,
        }))
        .filter((ch) => ch.text.trim());
    }

    if (docChapters.length === 0) {
      throw new Error(language
        ? `No selected chapters have a finished ${language} translation`
        : "No selected chapters have text");
    }

    await log(`${docChapters.length} of ${selectedCount} selected chapter${selectedCount !== 1 ? "s" : ""} have text`);

    const html = renderDocumentHtml({ bookTitle: book.title, chapters: docChapters });

    const outDir = bookOutputDir(bookId);
    const tmpDir = bookTmpDir(bookId);
    await mkdir(outDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    const timestamp = formatTimestamp(new Date());
    const suffix = language ? `_${languageSlug(language)}` : "";
    const htmlPath = path.join(tmpDir, `document${suffix}_${timestamp}.html`);
    const outputPath = path.join(outDir, `${sanitizeFilename(book.title)}${suffix}_${timestamp}.${format}`);

    await writeFile(htmlPath, html, "utf-8");
    await log(`Rendering ${format.toUpperCase()} with Vivliostyle (${docChapters.length} chapters)`);
    await buildDocument(htmlPath, outputPath);
    await unlink(htmlPath).catch(() => {});

    await db.insert(documents).values({
      bookId,
      language: language ?? null,
      format,
      outputPath,
      chapterCount: docChapters.length,
      chapterSummary: buildChapterSummary(docChapters.map((ch) => ch.index)),
      chapterIds: JSON.stringify(docChapters.map((ch) => ch.id)),
    });

    await db
      .update(books)
      .set({ status: "done", error: null, updatedAt: new Date() })
      .where(eq(books.id, bookId));

    await log(`${format.toUpperCase()} export complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`Document export failed: ${message}`);
    await db.update(books).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}

async function assembleReadaloud(
  bookId: string,
  bookTitle: string,
  language: string | null,
  copyToDropDir: boolean,
  log: (msg: string) => Promise<void>,
) {
  type Candidate = { id: string; index: number; title: string; audioPath: string | null; durationMs: number | null; chunkDir: string };

  let candidates: Candidate[];
  if (language) {
    const rows = await db
      .select({
        id: chapters.id,
        index: chapters.index,
        originalTitle: chapters.title,
        translatedTitle: chapterVariants.title,
        audioPath: chapterVariants.audioPath,
        durationMs: chapterVariants.audioDurationMs,
        audioStatus: chapterVariants.audioStatus,
      })
      .from(chapterVariants)
      .innerJoin(chapters, eq(chapterVariants.chapterId, chapters.id))
      .where(and(
        eq(chapters.bookId, bookId),
        eq(chapters.selected, true),
        eq(chapterVariants.key, language),
      ))
      .orderBy(asc(chapters.index));
    candidates = rows
      .filter((r) => r.audioStatus === "done")
      .map((r) => ({
        id: r.id,
        index: r.index,
        title: r.translatedTitle ?? r.originalTitle,
        audioPath: r.audioPath,
        durationMs: r.durationMs,
        chunkDir: translationChunkPreviewDir(bookId, language, r.index),
      }));
  } else {
    const rows = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.selected, true), eq(chapters.status, "done")))
      .orderBy(asc(chapters.index));
    candidates = rows.map((ch) => ({
      id: ch.id,
      index: ch.index,
      title: ch.title,
      audioPath: ch.audioPath,
      durationMs: ch.durationMs,
      chunkDir: chapterChunkPreviewDir(bookId, ch.index),
    }));
  }

  const readaloudChapters: ReadaloudChapter[] = [];
  const includedIds: string[] = [];
  const skipped: string[] = [];
  for (const ch of candidates) {
    if (!ch.audioPath || !ch.durationMs) {
      skipped.push(ch.title);
      continue;
    }
    const sync = await ensureSyncMap(ch.audioPath, ch.chunkDir, ch.durationMs);
    if (!sync) {
      skipped.push(ch.title);
      continue;
    }
    readaloudChapters.push({ index: ch.index, title: ch.title, audioPath: ch.audioPath, sync });
    includedIds.push(ch.id);
  }

  if (skipped.length > 0) {
    await log(`Skipping ${skipped.length} chapter(s) without timing data (no sync map and chunk WAVs already deleted): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}`);
  }
  if (readaloudChapters.length === 0) {
    throw new Error(language
      ? `No selected chapters have finished ${language} audio with timing data`
      : "No selected chapters have finished audio with timing data");
  }

  const outDir = bookOutputDir(bookId);
  const tmpDir = bookTmpDir(bookId);
  await mkdir(outDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const suffix = language ? `_${languageSlug(language)}` : "";
  const stagingDir = path.join(tmpDir, `readaloud${suffix}_${timestamp}`);
  const outputPath = path.join(outDir, `${sanitizeFilename(bookTitle)}${suffix}_readaloud_${timestamp}.epub`);

  await log(`Building synced EPUB (${readaloudChapters.length} chapters, read-along narration)`);
  try {
    await buildReadaloudEpub({
      title: bookTitle,
      language,
      chapters: readaloudChapters,
      stagingDir,
      outputPath,
    });
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }

  await db.insert(documents).values({
    bookId,
    language,
    format: "epub-sync",
    outputPath,
    chapterCount: readaloudChapters.length,
    chapterSummary: buildChapterSummary(readaloudChapters.map((ch) => ch.index)),
    chapterIds: JSON.stringify(includedIds),
  });

  if (copyToDropDir && env.READALOUD_DROP_DIR) {
    try {
      await mkdir(env.READALOUD_DROP_DIR, { recursive: true });
      await copyFile(outputPath, path.join(env.READALOUD_DROP_DIR, path.basename(outputPath)));
      await log(`Copied synced EPUB to import folder (${env.READALOUD_DROP_DIR})`);
    } catch (err) {
      await log(`Could not copy to import folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100) || "book";
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

// Build a compact summary like "Ch 1-3, 5, 7-10" from 0-based indices
function buildChapterSummary(indices: number[]): string {
  if (indices.length === 0) return "";
  const nums = indices.map((i) => i + 1).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = nums[0];
  let end = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = nums[i];
      end = nums[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return `Ch ${ranges.join(", ")}`;
}
