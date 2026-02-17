import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq, asc } from "drizzle-orm";
import { concatMp3s } from "../lib/ffmpeg.ts";
import { writeChapterMarkers } from "../lib/id3-chapters.ts";
import { bookOutputDir } from "../lib/paths.ts";
import path from "node:path";

export type AssemblePayload = {
  bookId: string;
};

export async function assemble(payload: AssemblePayload) {
  const { bookId } = payload;

  await db.update(books).set({ status: "assembling", updatedAt: new Date() }).where(eq(books.id, bookId));

  try {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    const allChapters = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.index));

    const mp3Paths = allChapters.map((ch) => {
      if (!ch.audioPath) throw new Error(`Chapter ${ch.index} (${ch.title}) has no audio`);
      return ch.audioPath;
    });

    const outDir = bookOutputDir(bookId);
    const outputPath = path.join(outDir, `${sanitizeFilename(book.title)}.mp3`);

    if (mp3Paths.length === 1) {
      // Single chapter — just use it directly (copy)
      const { copyFile } = await import("node:fs/promises");
      await copyFile(mp3Paths[0], outputPath);
    } else {
      await concatMp3s(mp3Paths, outputPath);
    }

    let offsetMs = 0;
    const chapterMetas = allChapters.map((ch) => {
      const startMs = offsetMs;
      const endMs = offsetMs + (ch.durationMs ?? 0);
      offsetMs = endMs;
      return { title: ch.title, startMs, endMs };
    });

    writeChapterMarkers(outputPath, {
      title: book.title,
      artist: "pdf2audio",
      chapters: chapterMetas,
    });

    await db
      .update(books)
      .set({ status: "done", outputPath, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(books).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100) || "audiobook";
}
