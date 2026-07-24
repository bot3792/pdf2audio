import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, bookFiles, chapters, bookLogs, assemblies } from "../schema.ts";
import type { Book, Chapter } from "../schema.ts";
import { eq, desc, asc, gt, and, ne, sql } from "drizzle-orm";
import { uploadsDir, bookTmpDir, bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { parseTtsVoice } from "../lib/tts.ts";
import { collectBlocksFromMarkerOutput, sliceChaptersAtIndices, type ExtractedChapter } from "../lib/marker.ts";
import { listMarkerSources } from "../lib/marker-sources.ts";
import { insertSuspendedChapters } from "../lib/insert-chapters.ts";
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

      // "extracting" immediately so the UI starts polling and double-enqueue is blocked
      const updates: Record<string, unknown> = {
        status: "extracting",
        error: null,
        outputPath: null,
        updatedAt: new Date(),
      };
      if (input.forceOcr !== undefined) updates.forceOcr = input.forceOcr;
      if (input.llmChapterDetection !== undefined) updates.llmChapterDetection = input.llmChapterDetection;
      await db.update(books).set(updates).where(eq(books.id, input.id));

      await appendLog(input.id, "Queued chapter re-detection");
      await quickAddJob({ connectionString }, "redetect", { bookId: input.id }, { maxAttempts: 1 });

      const [updated] = await db.select().from(books).where(eq(books.id, input.id));
      return updated;
    }),

  structure: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");

      const bookChapters = await db
        .select({ title: chapters.title, pageStart: chapters.pageStart, sourceFileIndex: chapters.sourceFileIndex })
        .from(chapters)
        .where(eq(chapters.bookId, input.id));

      const sources = await listMarkerSources(book);
      const files = [];

      for (const source of sources) {
        let allBlocks;
        try {
          allBlocks = await collectBlocksFromMarkerOutput(source.outDir);
        } catch {
          files.push({ fileIndex: source.fileIndex, filename: source.filename, missing: true, totalWords: 0, totalPages: 0, headings: [] });
          continue;
        }

        const currentStarts = new Set(
          bookChapters
            .filter((c) => c.sourceFileIndex === source.fileIndex)
            .map((c) => `${c.pageStart}|${c.title}`)
        );

        const headings = [];
        let cumWords = 0;
        for (let i = 0; i < allBlocks.length; i++) {
          const b = allBlocks[i];
          if (b.included && b.type === "SectionHeader") {
            headings.push({
              blockIndex: i,
              page: b.page,
              level: b.level ?? null,
              text: b.text,
              wordsBefore: cumWords,
              isChapterStart: currentStarts.has(`${b.page}|${b.text}`),
            });
          }
          if (b.included) cumWords += b.text.split(/\s+/).filter(Boolean).length;
        }

        files.push({
          fileIndex: source.fileIndex,
          filename: source.filename,
          missing: false,
          totalWords: cumWords,
          totalPages: allBlocks.length > 0 ? Math.max(...allBlocks.map((b) => b.page)) : 0,
          headings,
        });
      }

      return { files };
    }),

  proposeChapters: publicProcedure
    .input(z.object({ id: z.string().uuid(), method: z.enum(["llm", "deterministic"]) }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");

      // Stale-running escape hatch in case a propose job died without writing back
      const runningSince = book.chapterProposal?.status === "running" ? new Date(book.chapterProposal.createdAt).getTime() : null;
      if (runningSince && Date.now() - runningSince < 15 * 60_000) {
        throw new Error("A chapter proposal is already running");
      }

      await db
        .update(books)
        .set({ chapterProposal: { status: "running", method: input.method, createdAt: new Date().toISOString() }, updatedAt: new Date() })
        .where(eq(books.id, input.id));

      await appendLog(input.id, `Queued ${input.method === "llm" ? "LLM" : "deterministic"} chapter proposal`);
      await quickAddJob({ connectionString }, "propose", { bookId: input.id, method: input.method }, { maxAttempts: 1 });

      const [updated] = await db.select().from(books).where(eq(books.id, input.id));
      return updated;
    }),

  applyChapterBoundaries: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        boundaries: z
          .array(z.object({ fileIndex: z.number().int().nullable(), blockIndex: z.number().int().nonnegative() }))
          .min(1),
      })
    )
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");
      if (book.status === "extracting" || book.status === "assembling") {
        throw new Error("Cannot apply chapter boundaries while book is processing");
      }

      const sources = await listMarkerSources(book);
      const knownFiles = new Set(sources.map((s) => s.fileIndex));
      for (const b of input.boundaries) {
        if (!knownFiles.has(b.fileIndex)) throw new Error(`Unknown file index ${b.fileIndex}`);
      }

      // Slice everything before deleting so a bad boundary can't destroy existing chapters
      const perFile: { fileIndex: number | null; sliced: ExtractedChapter[] }[] = [];
      for (const source of sources) {
        const indices = input.boundaries.filter((b) => b.fileIndex === source.fileIndex).map((b) => b.blockIndex);
        const allBlocks = await collectBlocksFromMarkerOutput(source.outDir);
        for (const i of indices) {
          if (i >= allBlocks.length) throw new Error(`Block index ${i} out of range for "${source.filename}"`);
        }
        perFile.push({ fileIndex: source.fileIndex, sliced: sliceChaptersAtIndices(allBlocks, indices) });
      }

      const oldChapters = await db
        .select({ audioPath: chapters.audioPath })
        .from(chapters)
        .where(eq(chapters.bookId, input.id));
      const deletedAudioFiles = oldChapters.filter((ch) => ch.audioPath).length;

      await rm(bookOutputDir(input.id), { recursive: true, force: true }).catch(() => {});
      await db.delete(assemblies).where(eq(assemblies.bookId, input.id));
      await db.delete(chapters).where(eq(chapters.bookId, input.id));

      await appendLog(input.id, `Applying ${input.boundaries.length} manual chapter boundaries`);
      if (oldChapters.length > 0) {
        await appendLog(
          input.id,
          `Removed ${oldChapters.length} existing chapter${oldChapters.length === 1 ? "" : "s"} and ${deletedAudioFiles} chapter audio file${deletedAudioFiles === 1 ? "" : "s"}`
        );
      }

      let chapterOffset = 0;
      for (const { fileIndex, sliced } of perFile) {
        await insertSuspendedChapters(input.id, sliced, chapterOffset, fileIndex);
        chapterOffset += sliced.length;
      }

      await db
        .update(books)
        .set({
          totalChapters: chapterOffset,
          chapterDetection: "manual",
          chapterProposal: null,
          status: "pending",
          error: null,
          outputPath: null,
          updatedAt: new Date(),
        })
        .where(eq(books.id, input.id));

      await appendLog(input.id, `Applied chapter boundaries: ${chapterOffset} chapters — chapters are suspended. Queue selected chapters when ready.`);

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
