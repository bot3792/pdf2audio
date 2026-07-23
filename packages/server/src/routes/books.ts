import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, bookFiles, chapters, bookLogs, assemblies } from "../schema.ts";
import type { Book, Chapter } from "../schema.ts";
import { eq, desc, asc, gt, and, ne, inArray, sql } from "drizzle-orm";
import { uploadsDir, bookTmpDir, bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { redetectChaptersFromExistingMarkerOutput } from "../lib/marker.ts";
import { parseTtsVoice } from "../lib/tts.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, unlink, rm } from "node:fs/promises";
import { quickAddJob } from "graphile-worker";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

function computeBookStatus(
  book: Book,
  chapterList: Pick<Chapter, "status">[],
): string {
  if (book.status === "extracting" || book.status === "assembling") return book.status;
  if (chapterList.length === 0) {
    if (book.status === "failed") return "failed";
    return book.status;
  }
  const statuses = chapterList.map((c) => c.status);
  if (statuses.some((s) => s === "synthesizing" || s === "normalizing")) return "synthesizing";
  if (statuses.some((s) => s === "pending")) return "synthesizing";
  if (statuses.every((s) => s === "done")) {
    return book.outputPath ? "done" : "assembling";
  }
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.every((s) => s === "suspended" || s === "done")) return "suspended";
  return book.status;
}

async function insertRedetectedChapters(
  bookId: string,
  detected: { title: string; text: string; pageStart: number | null; pageEnd: number | null; sourceBlocks: unknown }[],
  chapterOffset: number,
  sourceFileIndex: number | null,
) {
  for (let i = 0; i < detected.length; i++) {
    const ch = detected[i];
    const globalIndex = chapterOffset + i;
    const wordCount = ch.text.split(/\s+/).filter(Boolean).length;
    await appendLog(bookId, `Chapter ${globalIndex + 1}: "${ch.title}" (${wordCount.toLocaleString()} words)`);

    await db
      .insert(chapters)
      .values({
        bookId,
        index: globalIndex,
        title: ch.title,
        rawText: ch.text,
        pageStart: ch.pageStart,
        pageEnd: ch.pageEnd,
        sourceBlocks: ch.sourceBlocks,
        sourceFileIndex,
        status: "suspended",
      });
  }
}

export const booksRouter = router({
  list: publicProcedure.query(async () => {
    const allBooks = await db
      .select()
      .from(books)
      .orderBy(desc(books.createdAt));

    const booksWithProgress = await Promise.all(
      allBooks.map(async (book) => {
        const allChapters = await db
          .select({ status: chapters.status })
          .from(chapters)
          .where(eq(chapters.bookId, book.id));

        const doneCount = allChapters.filter((c) => c.status === "done").length;
        const status = computeBookStatus(book, allChapters);
        return { ...book, status, chaptersCompleted: doneCount };
      })
    );

    return booksWithProgress;
  }),

  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");

      const allChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.bookId, input.id))
        .orderBy(asc(chapters.index));

      const chaptersWithStats = allChapters.map((ch) => {
        const text = ch.customText ?? ch.cleanText ?? ch.rawText;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const hasCleanText = !!ch.cleanText;
        const hasCustomText = !!ch.customText;
        const hasSourceBlocks = Array.isArray(ch.sourceBlocks);
        return { ...ch, wordCount, hasCleanText, hasCustomText, hasSourceBlocks, rawText: undefined, cleanText: undefined, customText: undefined, sourceBlocks: undefined };
      });

      const totalWords = chaptersWithStats.reduce((sum, ch) => sum + ch.wordCount, 0);
      const totalDurationMs = allChapters.reduce((sum, ch) => sum + (ch.durationMs ?? 0), 0);
      const status = computeBookStatus(book, allChapters);

      const files = await db
        .select()
        .from(bookFiles)
        .where(eq(bookFiles.bookId, input.id))
        .orderBy(asc(bookFiles.index));

      return { ...book, status, chapters: chaptersWithStats, totalWords, totalDurationMs, files };
    }),

  logs: publicProcedure
    .input(z.object({
      bookId: z.string().uuid(),
      after: z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const where = input.after
        ? and(eq(bookLogs.bookId, input.bookId), gt(bookLogs.createdAt, new Date(input.after)))
        : eq(bookLogs.bookId, input.bookId);

      return db
        .select({ id: bookLogs.id, message: bookLogs.message, fileIndex: bookLogs.fileIndex, createdAt: bookLogs.createdAt })
        .from(bookLogs)
        .where(where)
        .orderBy(asc(bookLogs.createdAt));
    }),

  clearLogs: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(bookLogs).where(eq(bookLogs.bookId, input.bookId));
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await db.update(books).set({ title: input.title, updatedAt: new Date() }).where(eq(books.id, input.id));
      return { success: true };
    }),

  updateSettings: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      voice: z.string().optional(),
      speed: z.number().min(0.5).max(2.0).optional(),
    }))
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.voice !== undefined) {
        parseTtsVoice(input.voice);
        updates.voice = input.voice;
      }
      if (input.speed !== undefined) updates.speed = input.speed;
      await db.update(books).set(updates).where(eq(books.id, input.id));
      return { success: true };
    }),

  upload: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        filename: z.string().min(1),
        voice: z.string().default("kokoro:af_heart"),
        speed: z.number().min(0.5).max(2.0).default(1.0),
        skipSynthesis: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      parseTtsVoice(input.voice);

      const id = randomUUID();
      const pdfDir = path.join(uploadsDir, id);
      await mkdir(pdfDir, { recursive: true });
      const pdfPath = path.join(pdfDir, input.filename);

      const [book] = await db
        .insert(books)
        .values({
          id,
          title: input.title,
          filename: input.filename,
          pdfPath,
          voice: input.voice,
          speed: input.speed,
          skipSynthesis: input.skipSynthesis,
        })
        .returning();

      await quickAddJob({ connectionString }, "extract", { bookId: id }, { maxAttempts: 1 });

      return book;
    }),

  retry: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        voice: z.string().optional(),
        speed: z.number().min(0.5).max(2.0).optional(),
        forceOcr: z.boolean().optional(),
        llmChapterDetection: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = {
        status: "pending",
        error: null,
        outputPath: null,
        updatedAt: new Date(),
      };
      if (input.voice) {
        parseTtsVoice(input.voice);
        updates.voice = input.voice;
      }
      if (input.speed) updates.speed = input.speed;
      if (input.forceOcr !== undefined) updates.forceOcr = input.forceOcr;
      if (input.llmChapterDetection !== undefined) updates.llmChapterDetection = input.llmChapterDetection;

      await db.update(books).set(updates).where(eq(books.id, input.id));
      await rm(bookOutputDir(input.id), { recursive: true, force: true }).catch(() => {});
      await db.delete(chapters).where(eq(chapters.bookId, input.id));
      await db.delete(assemblies).where(eq(assemblies.bookId, input.id));
      await db.update(bookFiles).set({ status: "pending", error: null }).where(eq(bookFiles.bookId, input.id));
      await db.delete(bookLogs).where(eq(bookLogs.bookId, input.id));
      await appendLog(input.id, "Re-extracting from scratch");

      await quickAddJob({ connectionString }, "extract", { bookId: input.id }, { maxAttempts: 1 });

      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      return book;
    }),

  redetectChapters: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        forceOcr: z.boolean().optional(),
        llmChapterDetection: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");
      if (book.status === "extracting" || book.status === "assembling") {
        throw new Error("Cannot re-detect chapters while book is processing");
      }

      const updates: Record<string, unknown> = {
        status: "pending",
        error: null,
        outputPath: null,
        updatedAt: new Date(),
      };
      if (input.forceOcr !== undefined) updates.forceOcr = input.forceOcr;
      if (input.llmChapterDetection !== undefined) updates.llmChapterDetection = input.llmChapterDetection;

      const allChapters = await db
        .select({
          audioPath: chapters.audioPath,
          title: chapters.title,
          pageStart: chapters.pageStart,
          pageEnd: chapters.pageEnd,
        })
        .from(chapters)
        .where(eq(chapters.bookId, input.id));

      const oldSignature = allChapters
        .map((c) => `${c.title}|${c.pageStart ?? ""}|${c.pageEnd ?? ""}`)
        .join("\n");

      const bookAssemblies = await db
        .select({ id: assemblies.id, outputPath: assemblies.outputPath })
        .from(assemblies)
        .where(eq(assemblies.bookId, input.id));

      const deletedAudioFiles = allChapters.filter((ch) => ch.audioPath).length;
      await rm(bookOutputDir(input.id), { recursive: true, force: true }).catch(() => {});

      await db.delete(assemblies).where(eq(assemblies.bookId, input.id));
      await db.delete(chapters).where(eq(chapters.bookId, input.id));
      await db.update(books).set(updates).where(eq(books.id, input.id));

      await appendLog(input.id, "Re-detecting chapters from existing extraction output");
      await appendLog(
        input.id,
        `Removed ${allChapters.length} existing chapter${allChapters.length === 1 ? "" : "s"}, ${bookAssemblies.length} assembl${bookAssemblies.length === 1 ? "y" : "ies"}, and ${deletedAudioFiles} chapter audio file${deletedAudioFiles === 1 ? "" : "s"}`
      );

      const finalLlmSetting = input.llmChapterDetection ?? book.llmChapterDetection;

      // Check if this is a multi-file book
      const files = await db
        .select()
        .from(bookFiles)
        .where(eq(bookFiles.bookId, input.id))
        .orderBy(asc(bookFiles.index));

      let totalDetected = 0;
      let detectionMethod: typeof books.$inferSelect.chapterDetection = null;

      if (files.length === 0) {
        // Legacy single-file book
        const { chapters: detected, method } = await redetectChaptersFromExistingMarkerOutput(bookTmpDir(input.id), book.pdfPath, (msg) => appendLog(input.id, msg), {
          llmChapterDetection: finalLlmSetting,
        });
        totalDetected = detected.length;
        detectionMethod = method;
        await insertRedetectedChapters(input.id, detected, 0, null);
      } else {
        // Multi-file book: re-detect per file
        let chapterOffset = 0;
        for (const file of files) {
          const fileTmpDir = path.join(bookTmpDir(input.id), `file_${file.index}`);
          try {
            const { chapters: detected, method } = await redetectChaptersFromExistingMarkerOutput(fileTmpDir, file.pdfPath, (msg) => appendLog(input.id, msg), {
              llmChapterDetection: finalLlmSetting,
            });
            await insertRedetectedChapters(input.id, detected, chapterOffset, file.index);
            chapterOffset += detected.length;
            totalDetected += detected.length;
            detectionMethod = method;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await appendLog(input.id, `Re-detection failed for "${file.filename}": ${message}`);
          }
        }
      }

      if (totalDetected === 0) {
        throw new Error("No chapters detected from existing extraction output");
      }

      await appendLog(input.id, `Detected ${totalDetected} chapters (${detectionMethod})`);

      await db
        .update(books)
        .set({ totalChapters: totalDetected, chapterDetection: detectionMethod, updatedAt: new Date() })
        .where(eq(books.id, input.id));

      // Compare new chapter boundaries with old
      const newChapters = await db
        .select({ title: chapters.title, pageStart: chapters.pageStart, pageEnd: chapters.pageEnd })
        .from(chapters)
        .where(eq(chapters.bookId, input.id))
        .orderBy(asc(chapters.index));

      const newSignature = newChapters
        .map((c) => `${c.title}|${c.pageStart ?? ""}|${c.pageEnd ?? ""}`)
        .join("\n");

      if (oldSignature === newSignature) {
        await appendLog(input.id, "Chapter boundaries unchanged from previous detection");
      } else {
        await appendLog(input.id, "Chapter boundaries updated");
      }

      await appendLog(input.id, "Chapter re-detection complete — chapters are suspended. Queue selected chapters when ready.");

      const [updated] = await db.select().from(books).where(eq(books.id, input.id));
      return updated;
    }),

  processSelected: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");

      const selectedChapters = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.bookId, input.id), eq(chapters.selected, true)))
        .orderBy(asc(chapters.index));

      const processable = selectedChapters.filter(
        (ch) => ch.status === "failed" || ch.status === "suspended" || ch.status === "pending" || ch.status === "done"
      );

      if (processable.length === 0) {
        throw new Error("No selected chapters are ready for synthesis");
      }

      await db.delete(bookLogs).where(eq(bookLogs.bookId, input.id));

      let queued = 0;
      let resynthesized = 0;
      for (const ch of processable) {
        if (ch.status === "done") {
          resynthesized++;
        }

        if (ch.cleanText) {
          await db
            .update(chapters)
            .set({ status: "pending", error: null, audioPath: null, durationMs: null, progress: null, synthesizedWith: null })
            .where(eq(chapters.id, ch.id));
          await quickAddJob({ connectionString }, "synthesize", { chapterId: ch.id, bookId: input.id }, { maxAttempts: 1 });
          queued++;
        } else {
          await db
            .update(chapters)
            .set({ status: "pending", error: null, audioPath: null, durationMs: null, progress: null, synthesizedWith: null })
            .where(eq(chapters.id, ch.id));
          await quickAddJob({ connectionString }, "normalize", { chapterId: ch.id, bookId: input.id }, { maxAttempts: 1 });
          queued++;
        }
      }

      await appendLog(
        input.id,
        `Queued ${queued} selected chapter${queued !== 1 ? "s" : ""} for synthesis with ${book.voice}${resynthesized > 0 ? ` (${resynthesized} re-synthesizing existing audio)` : ""}`
      );

      await db.update(books).set({ error: null, updatedAt: new Date() }).where(eq(books.id, input.id));

      const [updated] = await db.select().from(books).where(eq(books.id, input.id));
      return updated;
    }),

  assemble: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");

      const selectedDone = await db
        .select()
        .from(chapters)
        .where(and(
          eq(chapters.bookId, input.id),
          eq(chapters.selected, true),
          eq(chapters.status, "done"),
        ));

      const withAudio = selectedDone.filter((ch) => ch.audioPath);
      if (withAudio.length === 0) {
        throw new Error("No selected chapters with audio available for assembly");
      }

      await db
        .update(books)
        .set({ outputPath: null, error: null, updatedAt: new Date() })
        .where(eq(books.id, input.id));

      await appendLog(input.id, `Queuing assembly (${withAudio.length} selected chapter${withAudio.length !== 1 ? "s" : ""} with audio)`);
      await quickAddJob({ connectionString }, "assemble", { bookId: input.id }, { maxAttempts: 1 });

      const [updated] = await db.select().from(books).where(eq(books.id, input.id));
      return updated;
    }),

  cancel: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await appendLog(input.id, "Cancelled by user");

      await db
        .update(books)
        .set({ status: "failed", error: "Cancelled by user", updatedAt: new Date() })
        .where(eq(books.id, input.id));

      await db
        .update(chapters)
        .set({ status: "suspended", error: null })
        .where(and(
          eq(chapters.bookId, input.id),
          ne(chapters.status, "done"),
        ));

      const cleared = await db.execute(sql`
        DELETE FROM graphile_worker._private_jobs
        WHERE task_identifier IN ('normalize', 'synthesize')
          AND (payload ->> 'bookId') = ${input.id}
          AND run_at > now()
      `);

      const clearedCount = Array.isArray(cleared) ? 0 : Number((cleared as { rowCount?: number }).rowCount ?? 0);
      if (clearedCount > 0) {
        await appendLog(input.id, `Cleared ${clearedCount} queued job${clearedCount === 1 ? "" : "s"}`);
      }

      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));

      await db.delete(books).where(eq(books.id, input.id));

      if (book?.pdfPath) {
        await rm(path.dirname(book.pdfPath), { recursive: true, force: true }).catch(() => {});
      }
      await rm(bookOutputDir(input.id), { recursive: true, force: true }).catch(() => {});
      await rm(bookTmpDir(input.id), { recursive: true, force: true }).catch(() => {});

      return { success: true };
    }),

  assemblies: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(assemblies)
        .where(eq(assemblies.bookId, input.bookId))
        .orderBy(desc(assemblies.createdAt));
    }),

  deleteAssembly: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, input.id));
      if (!assembly) throw new Error("Assembly not found");

      if (assembly.outputPath) {
        await unlink(assembly.outputPath).catch(() => {});
      }

      // If this was the latest assembly (matches books.outputPath), clear it
      const [book] = await db.select().from(books).where(eq(books.id, assembly.bookId));
      if (book?.outputPath === assembly.outputPath) {
        // Find the next most recent assembly for this book
        const [nextAssembly] = await db
          .select()
          .from(assemblies)
          .where(and(eq(assemblies.bookId, assembly.bookId), ne(assemblies.id, input.id)))
          .orderBy(desc(assemblies.createdAt))
          .limit(1);

        await db
          .update(books)
          .set({
            outputPath: nextAssembly?.outputPath ?? null,
            updatedAt: new Date(),
          })
          .where(eq(books.id, assembly.bookId));
      }

      await db.delete(assemblies).where(eq(assemblies.id, input.id));
      return { success: true };
    }),
});
