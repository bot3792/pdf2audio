import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq, and, ne, notInArray } from "drizzle-orm";
import { synthesize as kokoroSynthesize } from "../lib/kokoro.ts";
import { wavToMp3 } from "../lib/ffmpeg.ts";
import { bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { parseFile } from "music-metadata";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { WorkerUtils } from "graphile-worker";

export type SynthesizePayload = {
  chapterId: string;
  bookId: string;
};

export async function synthesize(payload: SynthesizePayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { chapterId, bookId } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  const [currentChapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
  if (currentChapter?.status === "suspended") {
    await log(`[Ch ${(currentChapter.index ?? 0) + 1}] Skipped (suspended)`);
    return;
  }

  await db.update(chapters).set({ status: "synthesizing", error: null, progress: null }).where(eq(chapters.id, chapterId));
  await db.update(books).set({ error: null, updatedAt: new Date() }).where(eq(books.id, bookId));

  let chPrefix = "";
  const chLog = (msg: string) => appendLog(bookId, chPrefix + msg);

  try {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
    if (!chapter.cleanText) throw new Error(`Chapter ${chapterId} has no clean text`);

    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    chPrefix = `[Ch ${chapter.index + 1}] `;

    const wordCount = chapter.cleanText.split(/\s+/).filter(Boolean).length;
    await chLog(`Synthesizing "${chapter.title}" (${wordCount.toLocaleString()} words)`);

    const outDir = bookOutputDir(bookId);
    await mkdir(outDir, { recursive: true });

    const wavPath = path.join(outDir, `ch${String(chapter.index).padStart(3, "0")}.wav`);
    const mp3Path = path.join(outDir, `ch${String(chapter.index).padStart(3, "0")}.mp3`);

    await kokoroSynthesize({
      inputText: chapter.cleanText,
      outputPath: wavPath,
      voice: book.voice,
      speed: book.speed,
      log: chLog,
      onProgress: async (chunk, totalChunks) => {
        await db.update(chapters)
          .set({ progress: `${chunk}/${totalChunks}` })
          .where(eq(chapters.id, chapterId));
      },
    });

    await chLog(`Converting WAV to MP3`);
    await wavToMp3(wavPath, mp3Path);

    await unlink(wavPath).catch(() => {});
    await unlink(wavPath.replace(/\.wav$/, ".txt")).catch(() => {});

    const metadata = await parseFile(mp3Path, { duration: true });
    const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);

    await db
      .update(chapters)
      .set({ audioPath: mp3Path, durationMs, status: "done", progress: null })
      .where(eq(chapters.id, chapterId));

    const totalSec = Math.round(durationMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    await chLog(`Done — ${min}:${String(sec).padStart(2, "0")}`);

    // Check if all non-suspended chapters are done
    const remaining = await db
      .select()
      .from(chapters)
      .where(and(
        eq(chapters.bookId, bookId),
        notInArray(chapters.status, ["done", "suspended"]),
      ));

    if (remaining.length === 0) {
      // Check if there are any suspended chapters — if so, don't auto-assemble
      const suspended = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.bookId, bookId), eq(chapters.status, "suspended")));

      if (suspended.length === 0) {
        await log("All chapters synthesized, queuing assembly");
        await addJob("assemble", { bookId });
      } else {
        await log(`All queued chapters done (${suspended.length} suspended — queue them or assemble manually)`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chLog(`Synthesis failed: ${message}`);
    await db.update(chapters).set({ status: "failed", error: message }).where(eq(chapters.id, chapterId));
    throw err;
  }
}
