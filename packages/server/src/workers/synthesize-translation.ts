import { db } from "../db.ts";
import { chapters, books, chapterVariants } from "../schema.ts";
import { eq, and, ne, asc } from "drizzle-orm";
import { synthesize as ttsSynthesize, TtsAbortedError, voiceSupportsSpeed } from "../lib/tts.ts";
import { wavToMp3 } from "../lib/ffmpeg.ts";
import { bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { variantLabel } from "../lib/transform.ts";
import { parseFile } from "music-metadata";
import { mkdir, rm, unlink } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { buildSyncMapFromChunks, writeSyncMap } from "../lib/sync-map.ts";
import type { WorkerUtils } from "graphile-worker";

export type SynthesizeTranslationPayload = {
  translationId: string;
  bookId: string;
  resume?: boolean;
};

export function languageSlug(language: string) {
  return language.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function translationChunkPreviewDir(bookId: string, language: string, chapterIndex: number) {
  return path.join(bookOutputDir(bookId), "chunks", languageSlug(language), `ch${String(chapterIndex).padStart(3, "0")}`);
}

export async function synthesizeTranslation(
  payload: SynthesizeTranslationPayload,
  { addJob }: { addJob: WorkerUtils["addJob"] },
) {
  const { translationId, bookId, resume = false } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  const [current] = await db.select().from(chapterVariants).where(eq(chapterVariants.id, translationId));
  if (!current) throw new Error(`Translation ${translationId} not found`);
  if (current.audioStatus === "suspended") return;

  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, current.chapterId));
  if (!chapter) throw new Error(`Chapter ${current.chapterId} not found`);
  const chLog = (msg: string) => appendLog(bookId, `[Ch ${chapter.index + 1}] ${msg}`);

  const transitioned = await db
    .update(chapterVariants)
    .set({
      audioStatus: "synthesizing",
      audioError: null,
      updatedAt: new Date(),
      ...(resume ? {} : { audioProgress: null }),
    })
    .where(and(eq(chapterVariants.id, translationId), ne(chapterVariants.audioStatus, "suspended")))
    .returning({ id: chapterVariants.id });
  if (transitioned.length === 0) {
    await chLog(`Skipped (suspended)`);
    return;
  }

  const abortController = new AbortController();
  let cancelPoll: NodeJS.Timeout | null = null;
  let cancelCheckInFlight = false;

  try {
    // No fallback to the original text: an unfinished translation is an error, not English audio.
    if (current.status !== "done") {
      throw new Error(`${variantLabel(current)} text is not finished`);
    }
    const text = current.text;
    if (!text) throw new Error("Translation has no text");

    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    const slug = languageSlug(current.key);
    const label = variantLabel(current);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    await chLog(`Synthesizing "${chapter.title}" (${label}, ${wordCount.toLocaleString()} words)`);

    const outDir = path.join(bookOutputDir(bookId), slug);
    await mkdir(outDir, { recursive: true });

    const base = `ch${String(chapter.index).padStart(3, "0")}`;
    const wavPath = path.join(outDir, `${base}.wav`);
    const mp3Path = path.join(outDir, `${base}.mp3`);
    const chunkPreviewDir = translationChunkPreviewDir(bookId, current.key, chapter.index);
    const chunkPreviewUrlBase = `/files/${bookId}/chunks/${slug}/${base}`;

    if (resume) {
      await mkdir(chunkPreviewDir, { recursive: true });
      const existing = (await readdir(chunkPreviewDir).catch(() => []))
        .filter((f) => /^chunk-\d+\.wav$/.test(f))
        .sort();
      const last = existing.at(-1);
      if (last) await unlink(path.join(chunkPreviewDir, last)).catch(() => {});
      await chLog(`Resuming — reusing ${Math.max(existing.length - 1, 0)} already-synthesized chunk(s)`);
    } else {
      await rm(chunkPreviewDir, { recursive: true, force: true });
      await mkdir(chunkPreviewDir, { recursive: true });
    }

    cancelPoll = setInterval(async () => {
      if (cancelCheckInFlight) return;
      cancelCheckInFlight = true;
      try {
        const [latest] = await db
          .select({ audioStatus: chapterVariants.audioStatus })
          .from(chapterVariants)
          .where(eq(chapterVariants.id, translationId));
        if (latest?.audioStatus === "suspended") {
          abortController.abort();
        }
      } finally {
        cancelCheckInFlight = false;
      }
    }, 1500);

    await ttsSynthesize({
      inputText: text,
      outputPath: wavPath,
      voice: book.voice,
      speed: book.speed,
      chunkPreviewDir,
      chunkPreviewUrlBase,
      log: chLog,
      signal: abortController.signal,
      onProgress: async (chunk, totalChunks) => {
        const updated = await db.update(chapterVariants)
          .set({ audioProgress: `${chunk}/${totalChunks}`, updatedAt: new Date() })
          .where(and(eq(chapterVariants.id, translationId), ne(chapterVariants.audioStatus, "suspended")))
          .returning({ id: chapterVariants.id });
        if (updated.length === 0) {
          abortController.abort();
        }
      },
    });

    if (cancelPoll) {
      clearInterval(cancelPoll);
      cancelPoll = null;
    }

    const [latestAfterSynth] = await db
      .select({ audioStatus: chapterVariants.audioStatus })
      .from(chapterVariants)
      .where(eq(chapterVariants.id, translationId));
    if (latestAfterSynth?.audioStatus === "suspended") {
      await chLog("Stopped — cancelled by user");
      return;
    }

    await chLog(`Converting WAV to MP3`);
    await wavToMp3(wavPath, mp3Path);
    await unlink(wavPath).catch(() => {});
    await unlink(wavPath.replace(/\.wav$/, ".txt")).catch(() => {});

    const metadata = await parseFile(mp3Path, { duration: true });
    const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);

    // Persist text↔audio timings so read-along exports survive chunk-WAV cleanup
    const syncMap = await buildSyncMapFromChunks(chunkPreviewDir, durationMs).catch(() => null);
    if (syncMap) await writeSyncMap(mp3Path, syncMap);

    await db
      .update(chapterVariants)
      .set({
        audioPath: mp3Path,
        audioDurationMs: durationMs,
        audioStatus: "done",
        audioProgress: null,
        synthesizedWith: {
          voice: book.voice,
          speed: voiceSupportsSpeed(book.voice) ? book.speed : null,
        },
        updatedAt: new Date(),
      })
      .where(eq(chapterVariants.id, translationId));

    const totalSec = Math.round(durationMs / 1000);
    await chLog(`Done — ${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")} (${label})`);

    // Auto-assemble when every selected chapter with a finished translation has its audio
    const rows = await db
      .select({
        audioStatus: chapterVariants.audioStatus,
        selected: chapters.selected,
      })
      .from(chapterVariants)
      .innerJoin(chapters, eq(chapterVariants.chapterId, chapters.id))
      .where(and(
        eq(chapters.bookId, bookId),
        eq(chapterVariants.key, current.key),
        eq(chapterVariants.status, "done"),
        eq(chapters.selected, true),
      ))
      .orderBy(asc(chapters.index));

    const remaining = rows.filter((r) => r.audioStatus !== "done" && r.audioStatus !== "suspended");
    const suspended = rows.filter((r) => r.audioStatus === "suspended");
    if (rows.length > 0 && remaining.length === 0) {
      if (suspended.length === 0) {
        await log(`All ${label} chapters synthesized, queuing assembly`);
        await addJob("assemble", { bookId, language: current.key }, { maxAttempts: 1 });
      } else {
        await log(`All queued ${label} chapters done (${suspended.length} suspended — queue them or assemble manually)`);
      }
    }
  } catch (err) {
    if (cancelPoll) {
      clearInterval(cancelPoll);
      cancelPoll = null;
    }

    if (err instanceof TtsAbortedError) {
      await db.update(chapterVariants)
        .set({ audioStatus: "suspended", audioError: null, updatedAt: new Date() })
        .where(eq(chapterVariants.id, translationId));
      await chLog("Stopped — cancelled by user");
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    await chLog(`Synthesis failed: ${message}`);
    await db.update(chapterVariants)
      .set({ audioStatus: "failed", audioError: message, updatedAt: new Date() })
      .where(eq(chapterVariants.id, translationId));
    throw err;
  }
}
