import { db } from "../db.ts";
import { chapters, books, assemblies } from "../schema.ts";
import { eq, asc, and } from "drizzle-orm";
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

    const selectedChapters = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.selected, true)))
      .orderBy(asc(chapters.index));

    const chaptersWithAudio = selectedChapters.filter((ch) => ch.audioPath && ch.status === "done");
    if (chaptersWithAudio.length === 0) {
      throw new Error("No selected chapters with audio available for assembly");
    }

    await log(`${chaptersWithAudio.length} of ${selectedChapters.length} selected chapter${selectedChapters.length !== 1 ? "s" : ""} have audio`);

    const mp3Paths = chaptersWithAudio.map((ch) => ch.audioPath!);

    const outDir = bookOutputDir(bookId);
    const timestamp = formatTimestamp(new Date());
    const outputPath = path.join(outDir, `${sanitizeFilename(book.title)}_${timestamp}.mp3`);

    if (mp3Paths.length === 1) {
      await log("Single chapter — copying to output");
      const { copyFile } = await import("node:fs/promises");
      await copyFile(mp3Paths[0], outputPath);
    } else {
      await log(`Concatenating ${mp3Paths.length} chapter MP3s`);
      await concatMp3s(mp3Paths, outputPath);
    }

    let offsetMs = 0;
    const chapterMetas = chaptersWithAudio.map((ch) => {
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

    const durationMs = offsetMs;
    const totalSec = Math.round(durationMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    await log(`Assembly complete — ${min}:${String(sec).padStart(2, "0")} total duration`);

    const chapterIds = chaptersWithAudio.map((ch) => ch.id);
    const chapterSummary = buildChapterSummary(chaptersWithAudio.map((ch) => ch.index));

    await db.insert(assemblies).values({
      bookId,
      outputPath,
      durationMs,
      chapterCount: chaptersWithAudio.length,
      chapterSummary,
      chapterIds: JSON.stringify(chapterIds),
    });

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
