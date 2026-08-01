import { db } from "../db.ts";
import { chapters, books, documents, chapterTranslations } from "../schema.ts";
import { eq, asc, and } from "drizzle-orm";
import { renderDocumentHtml, type DocumentChapter } from "../lib/document-html.ts";
import { buildDocument } from "../lib/vivliostyle.ts";
import { bookOutputDir, bookTmpDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { languageSlug } from "./synthesize-translation.ts";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export type AssembleDocumentPayload = {
  bookId: string;
  language?: string;
  format: "pdf" | "epub";
};

export async function assembleDocument(payload: AssembleDocumentPayload) {
  const { bookId, language, format } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  await db.update(books).set({ status: "assembling", updatedAt: new Date() }).where(eq(books.id, bookId));
  await log(language ? `Starting ${format.toUpperCase()} export (${language})` : `Starting ${format.toUpperCase()} export`);

  try {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

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
          translatedTitle: chapterTranslations.title,
          translatedText: chapterTranslations.text,
          translationStatus: chapterTranslations.status,
        })
        .from(chapterTranslations)
        .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
        .where(and(
          eq(chapters.bookId, bookId),
          eq(chapters.selected, true),
          eq(chapterTranslations.language, language),
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
