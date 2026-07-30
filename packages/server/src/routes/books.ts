import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, bookFiles, chapters, bookLogs, assemblies, documents, chapterTranslations } from "../schema.ts";
import type { Book, Chapter } from "../schema.ts";
import { eq, desc, asc, gt, and, ne, inArray, sql } from "drizzle-orm";
import { uploadsDir, bookTmpDir, bookOutputDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";
import { parseTtsVoice } from "../lib/tts.ts";
import { collectBlocksFromMarkerOutput, sliceChaptersAtIndices, type ExtractedChapter } from "../lib/marker.ts";
import { listMarkerSources } from "../lib/marker-sources.ts";
import { abortExtract } from "../lib/extract-registry.ts";
import { measureBookDiskUsage, measureDirs, removeDirs, bookTotalSizeCached } from "../lib/disk-usage.ts";
import { chapterChunkPreviewDir } from "../lib/chunk-previews.ts";
import { translationChunkPreviewDir } from "../workers/synthesize-translation.ts";
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

// Chunk WAVs only matter for resuming a partial synthesis — finished chapters never reread them
async function cleanableChunkDirs(bookId: string): Promise<string[]> {
  const doneChapters = await db
    .select({ index: chapters.index })
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.status, "done")));

  const doneTranslations = await db
    .select({ language: chapterTranslations.language, index: chapters.index })
    .from(chapterTranslations)
    .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
    .where(and(eq(chapters.bookId, bookId), eq(chapterTranslations.audioStatus, "done")));

  return [
    ...doneChapters.map((c) => chapterChunkPreviewDir(bookId, c.index)),
    ...doneTranslations.map((t) => translationChunkPreviewDir(bookId, t.language, t.index)),
  ];
}

export const booksRouter = router({
  list: publicProcedure.query(async () => {
    const allBooks = await db.select().from(books).orderBy(desc(books.createdAt));

    const chapterAgg = (await db.execute(sql`
      SELECT book_id, status, count(*)::int AS count FROM chapters GROUP BY book_id, status
    `)) as unknown as Array<{ book_id: string; status: string; count: number }>;

    const cleanupAgg = (await db.execute(sql`
      SELECT book_id, cleanup->>'status' AS status, count(*)::int AS count
      FROM chapters WHERE cleanup IS NOT NULL GROUP BY book_id, cleanup->>'status'
    `)) as unknown as Array<{ book_id: string; status: string; count: number }>;

    const fileAgg = (await db.execute(sql`
      SELECT book_id, status, count(*)::int AS count,
        count(*) FILTER (WHERE status = 'failed' AND error NOT LIKE 'Cancelled%')::int AS hard_failed
      FROM book_files GROUP BY book_id, status
    `)) as unknown as Array<{ book_id: string; status: string; count: number; hard_failed: number }>;

    const translationAgg = (await db.execute(sql`
      SELECT c.book_id, ct.language,
        count(*) FILTER (WHERE ct.status = 'done')::int AS done,
        count(*) FILTER (WHERE ct.status IN ('translating', 'pending'))::int AS running,
        count(*) FILTER (WHERE ct.status = 'failed')::int AS failed,
        count(*) FILTER (WHERE ct.audio_status = 'synthesizing')::int AS audio_running
      FROM chapter_translations ct JOIN chapters c ON c.id = ct.chapter_id
      GROUP BY c.book_id, ct.language ORDER BY ct.language
    `)) as unknown as Array<{ book_id: string; language: string; done: number; running: number; failed: number; audio_running: number }>;

    const assemblyAgg = (await db.execute(sql`
      SELECT book_id, count(*)::int AS count FROM assemblies GROUP BY book_id
    `)) as unknown as Array<{ book_id: string; count: number }>;

    const documentAgg = (await db.execute(sql`
      SELECT book_id, format, count(*)::int AS count FROM documents GROUP BY book_id, format
    `)) as unknown as Array<{ book_id: string; format: "pdf" | "epub"; count: number }>;

    const lastLogAgg = (await db.execute(sql`
      SELECT book_id, max(created_at) AS last FROM book_logs GROUP BY book_id
    `)) as unknown as Array<{ book_id: string; last: string }>;

    const byBook = <T extends { book_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.book_id) ?? [];
        list.push(row);
        map.set(row.book_id, list);
      }
      return map;
    };
    const chaptersBy = byBook(chapterAgg);
    const cleanupBy = byBook(cleanupAgg);
    const filesBy = byBook(fileAgg);
    const translationsBy = byBook(translationAgg);
    const assembliesBy = byBook(assemblyAgg);
    const documentsBy = byBook(documentAgg);
    const lastLogBy = new Map(lastLogAgg.map((r) => [r.book_id, r.last]));

    const overview = await Promise.all(
      allBooks.map(async (book) => {
        const chapterCounts = chaptersBy.get(book.id) ?? [];
        const countOf = (rows: { status: string; count: number }[], ...statuses: string[]) =>
          rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.count, 0);

        const chapterCount = chapterCounts.reduce((sum, r) => sum + r.count, 0);
        const chaptersWithAudio = countOf(chapterCounts, "done");
        const translations = translationsBy.get(book.id) ?? [];
        const fileRows = filesBy.get(book.id) ?? [];
        const cleanupRows = cleanupBy.get(book.id) ?? [];
        const documentRows = documentsBy.get(book.id) ?? [];

        const activity = {
          extracting: countOf(fileRows, "extracting", "pending") > 0 || book.status === "extracting",
          synthesizing:
            countOf(chapterCounts, "pending", "normalizing", "synthesizing") +
            translations.reduce((sum, t) => sum + t.audio_running, 0),
          translating: translations.reduce((sum, t) => sum + t.running, 0),
          cleaning: countOf(cleanupRows, "pending", "cleaning"),
          assembling: book.status === "assembling",
        };
        const failures = {
          files: fileRows.reduce((sum, r) => sum + r.hard_failed, 0),
          chapters: countOf(chapterCounts, "failed"),
          translations: translations.reduce((sum, t) => sum + t.failed, 0),
          cleanup: countOf(cleanupRows, "failed"),
        };

        const lastLog = lastLogBy.get(book.id);
        const lastActivityAt = new Date(
          Math.max(new Date(book.updatedAt).getTime(), lastLog ? new Date(lastLog).getTime() : 0),
        );

        return {
          id: book.id,
          title: book.title,
          createdAt: book.createdAt,
          skipSynthesis: book.skipSynthesis,
          error: book.status === "failed" ? book.error : null,
          chapterCount,
          chaptersWithAudio,
          activity,
          failures,
          languages: translations.map((t) => ({ language: t.language, done: t.done })),
          outputs: {
            assemblies: assembliesBy.get(book.id)?.[0]?.count ?? 0,
            pdfs: documentRows.find((d) => d.format === "pdf")?.count ?? 0,
            epubs: documentRows.find((d) => d.format === "epub")?.count ?? 0,
          },
          lastActivityAt,
          sizeBytes: await bookTotalSizeCached(book.id),
        };
      }),
    );

    return overview.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
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
      forceOcr: z.boolean().optional(),
      llmChapterDetection: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.voice !== undefined) {
        parseTtsVoice(input.voice);
        updates.voice = input.voice;
      }
      if (input.speed !== undefined) updates.speed = input.speed;
      if (input.forceOcr !== undefined) updates.forceOcr = input.forceOcr;
      if (input.llmChapterDetection !== undefined) updates.llmChapterDetection = input.llmChapterDetection;
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
          .array(
            z.object({
              fileIndex: z.number().int().nullable(),
              blockIndex: z.number().int().nonnegative(),
              title: z.string().trim().min(1).optional(),
            })
          )
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
        const fileBoundaries = input.boundaries.filter((b) => b.fileIndex === source.fileIndex);
        const indices = fileBoundaries.map((b) => b.blockIndex);
        const titles = new Map(fileBoundaries.filter((b) => b.title).map((b) => [b.blockIndex, b.title!]));
        const allBlocks = await collectBlocksFromMarkerOutput(source.outDir);
        for (const i of indices) {
          if (i >= allBlocks.length) throw new Error(`Block index ${i} out of range for "${source.filename}"`);
        }
        perFile.push({ fileIndex: source.fileIndex, sliced: sliceChaptersAtIndices(allBlocks, indices, titles) });
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

  exportDocument: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      language: z.string().min(1).optional(),
      format: z.enum(["pdf", "epub"]),
    }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.id));
      if (!book) throw new Error("Book not found");
      if (book.status === "assembling") throw new Error("Assembly already in progress");

      let exportable: number;
      if (input.language) {
        const rows = await db
          .select({ id: chapters.id })
          .from(chapterTranslations)
          .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
          .where(and(
            eq(chapters.bookId, input.id),
            eq(chapters.selected, true),
            eq(chapterTranslations.language, input.language),
            eq(chapterTranslations.status, "done"),
          ));
        exportable = rows.length;
      } else {
        const rows = await db
          .select({ id: chapters.id })
          .from(chapters)
          .where(and(eq(chapters.bookId, input.id), eq(chapters.selected, true)));
        exportable = rows.length;
      }
      if (exportable === 0) {
        throw new Error(input.language
          ? `No selected chapters have a finished ${input.language} translation`
          : "No chapters selected");
      }

      await appendLog(input.id, `Queuing ${input.format.toUpperCase()} export (${exportable} chapter${exportable !== 1 ? "s" : ""})${input.language ? ` · ${input.language}` : ""}`);
      // jobKey: repeat clicks replace the queued job instead of stacking duplicates
      await quickAddJob(
        { connectionString },
        "assembleDocument",
        { bookId: input.id, language: input.language, format: input.format },
        { maxAttempts: 1, jobKey: `assembleDocument:${input.id}:${input.format}:${input.language ?? "original"}`, jobKeyMode: "replace" },
      );
      return { success: true };
    }),

  pendingDocumentExports: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = (await db.execute(sql`
        SELECT j.payload->>'format' AS format, j.payload->>'language' AS language, j.locked_at IS NOT NULL AS running
        FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier = 'assembleDocument' AND j.payload->>'bookId' = ${input.bookId}
      `)) as unknown as Array<{ format: "pdf" | "epub"; language: string | null; running: boolean }>;
      return rows;
    }),

  documents: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(documents)
        .where(eq(documents.bookId, input.bookId))
        .orderBy(desc(documents.createdAt));
    }),

  deleteDocument: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [document] = await db.select().from(documents).where(eq(documents.id, input.id));
      if (!document) throw new Error("Document not found");

      await unlink(document.outputPath).catch(() => {});
      await db.delete(documents).where(eq(documents.id, input.id));
      return { success: true };
    }),

  diskUsage: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      const asm = await db.select({ outputPath: assemblies.outputPath }).from(assemblies).where(eq(assemblies.bookId, input.bookId));
      const docs = await db.select({ outputPath: documents.outputPath }).from(documents).where(eq(documents.bookId, input.bookId));
      const usage = await measureBookDiskUsage(
        input.bookId,
        new Set(asm.map((a) => a.outputPath)),
        new Set(docs.map((d) => d.outputPath)),
      );
      const cleanableChunkWavs = await measureDirs(await cleanableChunkDirs(input.bookId));
      return { ...usage, cleanableChunkWavs };
    }),

  cleanupChunks: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const freed = await removeDirs(await cleanableChunkDirs(input.bookId));
      await appendLog(input.bookId, `Cleaned up WAV chunks of finished chapters — freed ${(freed / 1e9).toFixed(2)} GB`);
      return { freed };
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

      const cancelledFiles = await db
        .update(bookFiles)
        .set({ status: "failed", error: "Cancelled by user" })
        .where(and(
          eq(bookFiles.bookId, input.id),
          inArray(bookFiles.status, ["extracting", "pending"]),
        ))
        .returning({ id: bookFiles.id });
      let killedCount = 0;
      for (const f of cancelledFiles) {
        if (abortExtract(f.id)) killedCount++;
      }
      if (abortExtract(input.id)) killedCount++; // legacy single-file extraction is keyed by bookId
      if (cancelledFiles.length > 0) {
        await appendLog(input.id, `Cancelled extraction of ${cancelledFiles.length} file(s)${killedCount > 0 ? ` — stopped ${killedCount} running process(es)` : ""}`);
      }

      const cleared = (await db.execute(sql`
        DELETE FROM graphile_worker._private_jobs j
        USING graphile_worker._private_tasks t
        WHERE t.id = j.task_id AND t.identifier IN ('normalize', 'synthesize', 'extract')
          AND (j.payload ->> 'bookId') = ${input.id}
          AND j.locked_at IS NULL
        RETURNING j.id
      `)) as unknown as unknown[];

      const clearedCount = cleared.length;
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
