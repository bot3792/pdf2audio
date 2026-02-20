import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq, asc } from "drizzle-orm";
import { concatMp3s } from "../lib/ffmpeg.ts";
import { writeChapterMarkers } from "../lib/id3-chapters.ts";
import { bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import path from "node:path";

export type AssemblePayload = {
  bookId: string;
};

export async function assemble(payload: AssemblePayload) {
  const { bookId } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  await db.update(books).set({ status: "assembling", updatedAt: new Date() }).where(eq(books.id, bookId));
  await log("Starting assembly");

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
      await log("Single chapter — copying to output");
      const { copyFile } = await import("node:fs/promises");
      await copyFile(mp3Paths[0], outputPath);
    } else {
      await log(`Concatenating ${mp3Paths.length} chapter MP3s`);
      await concatMp3s(mp3Paths, outputPath);
    }

    let offsetMs = 0;
    const chapterMetas = allChapters.map((ch) => {
      const startMs = offsetMs;
      const endMs = offsetMs + (ch.durationMs ?? 0);
      offsetMs = endMs;
      return { title: ch.title, startMs, endMs };
    });

    await log("Writing ID3v2 chapter markers");
    writeChapterMarkers(outputPath, {
      title: book.title,
      artist: "pdf2audio",
      chapters: chapterMetas,
    });

    const totalSec = Math.round(offsetMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    await log(`Assembly complete — ${min}:${String(sec).padStart(2, "0")} total duration`);

    await db
      .update(books)
      .set({ status: "done", outputPath, error: null, updatedAt: new Date() })
      .where(eq(books.id, bookId));

    await log("Done!");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`Assembly failed: ${message}`);
    await db.update(books).set({ error: message, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100) || "audiobook";
}
