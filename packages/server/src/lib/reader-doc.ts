import { asc, eq } from "drizzle-orm";

import { db } from "../db.ts";
import { bookFiles, chapters, books, type Book, type Chapter } from "../schema.ts";
import { cuesFromSyncMap, type CueGranularity } from "./cues.ts";
import { rectsForRange, type CueRect } from "./cue-rects.ts";
import { locateChunks } from "./chunk-previews.ts";
import { listMarkerSources } from "./marker-sources.ts";
import { languageCode } from "./readaloud-epub.ts";
import { ensureSourceGeometry, medianBodyPt, pageLayout, type GeometryPage, type Rect } from "./page-geometry.ts";
import { readSyncMap, type SyncWord } from "./sync-map.ts";
import type { SourceBlock } from "./marker.ts";

// The reader reads this document, never the database — every gap in it shows up here first.
export const READER_FORMAT = "p2af/1";

export type ReaderPage = { i: number; src: number; w: number; h: number; rot: number; content: Rect; columns: Rect[] };

export type ReaderManifest = {
  format: string;
  book: { id: string; title: string; language: string; medianBodyPt: number | null };
  sources: { index: number; filename: string; url: string; pageCount: number }[];
  pages: ReaderPage[];
  chapters: {
    i: number;
    id: string;
    title: string;
    audio: string | null;
    cues: string;
    durationMs: number | null;
    pageStart: number | null;
    pageEnd: number | null;
    mode: "page" | "text";
  }[];
};

export type ReaderCue = { t: [number, number]; s: string; r?: CueRect[]; w?: [number, number, string][] };

export type ReaderCues = { format: string; totalMs: number; granularity: CueGranularity; cues: ReaderCue[] };

// Edited, synthetic, or extracted before the text map existed — no rects rather than wrong ones
function chapterMode(chapter: Chapter): "page" | "text" {
  return chapter.textMap && !chapter.customText && Array.isArray(chapter.sourceBlocks) ? "page" : "text";
}

export async function buildManifest(book: Book): Promise<ReaderManifest> {
  const files = await db.select().from(bookFiles).where(eq(bookFiles.bookId, book.id)).orderBy(asc(bookFiles.index));
  const sources = await listMarkerSources(book);

  const pages: ReaderPage[] = [];
  const geometryPages: GeometryPage[] = [];
  const sourceEntries: ReaderManifest["sources"] = [];

  for (const source of sources) {
    const file = files.find((f) => f.index === source.fileIndex);
    const geometry = await ensureSourceGeometry(source).catch(() => null);
    const offset = pages.length;

    for (const page of geometry?.pages ?? []) {
      const layout = pageLayout(page);
      pages.push({
        i: offset + page.i,
        src: sourceEntries.length,
        w: page.w,
        h: page.h,
        rot: page.rot,
        content: layout.content,
        columns: layout.columns,
      });
      geometryPages.push(page);
    }

    sourceEntries.push({
      index: sourceEntries.length,
      filename: source.filename,
      url: file ? `/pdf/${file.id}` : `/pdf/book/${book.id}`,
      pageCount: geometry?.pages.length ?? 0,
    });
  }

  const rows = await db.select().from(chapters).where(eq(chapters.bookId, book.id)).orderBy(asc(chapters.index));
  const offsets = pageOffsets(sources.map((s) => s.fileIndex), pages);

  return {
    format: READER_FORMAT,
    book: {
      id: book.id,
      title: book.title,
      language: languageCode(book.language),
      medianBodyPt: medianBodyPt(geometryPages),
    },
    sources: sourceEntries,
    pages,
    chapters: rows.map((chapter) => {
      const offset = offsets.get(chapter.sourceFileIndex) ?? 0;
      return {
        i: chapter.index,
        id: chapter.id,
        title: chapter.title,
        audio: chapter.audioPath ? `/audio/chapter/${chapter.id}` : null,
        cues: `/read/chapter/${chapter.id}/cues.json`,
        durationMs: chapter.durationMs,
        pageStart: chapter.pageStart === null ? null : offset + chapter.pageStart - 1,
        pageEnd: chapter.pageEnd === null ? null : offset + chapter.pageEnd - 1,
        mode: chapterMode(chapter),
      };
    }),
  };
}

// Flat page index across the book's PDFs — a chapter's page numbers are relative to its own file
function pageOffsets(fileIndexes: (number | null)[], pages: ReaderPage[]): Map<number | null, number> {
  const offsets = new Map<number | null, number>();
  fileIndexes.forEach((fileIndex, source) => {
    const first = pages.find((page) => page.src === source);
    offsets.set(fileIndex, first?.i ?? 0);
  });
  return offsets;
}

export async function buildCues(chapter: Chapter): Promise<ReaderCues | null> {
  if (!chapter.audioPath) return null;
  const map = await readSyncMap(chapter.audioPath);
  if (!map) return null;

  const { granularity, cues } = cuesFromSyncMap(map);
  const rects = await cueRects(chapter, cues.map((cue) => cue.text));

  return {
    format: READER_FORMAT,
    totalMs: map.totalMs,
    granularity,
    cues: cues.map((cue, i) => ({
      t: [cue.startMs, cue.endMs] as [number, number],
      s: cue.text,
      ...(rects[i]?.length ? { r: rects[i] } : {}),
      ...(cue.words ? { w: cue.words.map(wordTuple) } : {}),
    })),
  };
}

function wordTuple(word: SyncWord): [number, number, string] {
  return [word.startMs, word.endMs, word.text];
}

async function cueRects(chapter: Chapter, texts: string[]): Promise<CueRect[][]> {
  const empty = texts.map(() => []);
  if (chapterMode(chapter) === "text" || !chapter.cleanText) return empty;

  const [book] = await db.select().from(books).where(eq(books.id, chapter.bookId));
  if (!book) return empty;

  const sources = await listMarkerSources(book);
  const source = sources.find((s) => s.fileIndex === chapter.sourceFileIndex) ?? sources[0];
  if (!source) return empty;

  const geometry = await ensureSourceGeometry(source).catch(() => null);
  const offset = await flatPageOffset(book, source.fileIndex);

  const context = {
    cleanText: chapter.cleanText,
    textMap: chapter.textMap!,
    blocks: chapter.sourceBlocks as SourceBlock[],
    page: (blockPage: number) => ({
      index: offset + blockPage - 1,
      geometry: geometry?.pages[blockPage - 1] ?? null,
    }),
  };

  const ranges = locateChunks(chapter.cleanText, texts);
  return ranges.map((range) => (range ? rectsForRange(context, range.start, range.end) : []));
}

async function flatPageOffset(book: Book, fileIndex: number | null): Promise<number> {
  if (fileIndex === null || fileIndex === 0) return 0;
  const sources = await listMarkerSources(book);
  let offset = 0;
  for (const source of sources) {
    if (source.fileIndex === fileIndex) break;
    const geometry = await ensureSourceGeometry(source).catch(() => null);
    offset += geometry?.pages.length ?? 0;
  }
  return offset;
}

export async function chapterForReader(chapterId: string): Promise<Chapter | null> {
  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
  return chapter ?? null;
}

export async function bookForReader(bookId: string): Promise<Book | null> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  return book ?? null;
}
