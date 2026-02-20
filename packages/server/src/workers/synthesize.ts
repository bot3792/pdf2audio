import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq, and, ne } from "drizzle-orm";
import { synthesize as kokoroSynthesize } from "../lib/kokoro.ts";
import { wavToMp3 } from "../lib/ffmpeg.ts";
import { bookOutputDir } from "../lib/paths.ts";
import { parseFile } from "music-metadata";
import { mkdir } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { WorkerUtils } from "graphile-worker";

export type SynthesizePayload = {
  chapterId: string;
  bookId: string;
};

export async function synthesize(payload: SynthesizePayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { chapterId, bookId } = payload;

  await db.update(chapters).set({ status: "synthesizing", error: null }).where(eq(chapters.id, chapterId));
  await db.update(books).set({ status: "synthesizing", error: null, updatedAt: new Date() }).where(eq(books.id, bookId));

  try {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
    if (!chapter.cleanText) throw new Error(`Chapter ${chapterId} has no clean text`);

    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    const outDir = bookOutputDir(bookId);
    await mkdir(outDir, { recursive: true });

    const wavPath = path.join(outDir, `ch${String(chapter.index).padStart(3, "0")}.wav`);
    const mp3Path = path.join(outDir, `ch${String(chapter.index).padStart(3, "0")}.mp3`);

    await kokoroSynthesize({
      inputText: chapter.cleanText,
      outputPath: wavPath,
      voice: book.voice,
      speed: book.speed,
    });

    await wavToMp3(wavPath, mp3Path);

    // Clean up WAV to save disk space
    await unlink(wavPath).catch(() => {});
    await unlink(wavPath.replace(/\.wav$/, ".txt")).catch(() => {});

    const metadata = await parseFile(mp3Path, { duration: true });
    const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);

    await db
      .update(chapters)
      .set({ audioPath: mp3Path, durationMs, status: "done" })
      .where(eq(chapters.id, chapterId));

    // Check if all chapters for this book are done
    const remaining = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), ne(chapters.status, "done")));

    if (remaining.length === 0) {
      await addJob("assemble", { bookId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(chapters).set({ status: "failed", error: message }).where(eq(chapters.id, chapterId));
    await db.update(books).set({ status: "failed", error: `Chapter synthesis failed: ${message}`, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}
