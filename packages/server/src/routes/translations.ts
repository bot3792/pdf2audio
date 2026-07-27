import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import { quickAddJob } from "graphile-worker";
import { appendLog } from "../lib/log.ts";
import { env } from "../env.ts";
import { listChunkPreviewsIn, locateChunks, pageAtOffset } from "../lib/chunk-previews.ts";
import { languageSlug, translationChunkPreviewDir } from "../workers/synthesize-translation.ts";
import type { SourceBlock } from "../lib/marker.ts";

const connectionString = env.DATABASE_URL;

const STALE_RUNNING_MS = 15 * 60_000;

// Requeueing without this leaves the old job behind and two workers end up
// interleaving writes on the same translation row.
async function deleteQueuedTranslateJobs(translationIds: string[]) {
  if (translationIds.length === 0) return;
  await db.execute(sql`
    DELETE FROM graphile_worker._private_jobs j
    USING graphile_worker._private_tasks t
    WHERE t.id = j.task_id AND t.identifier = 'translate'
      AND (j.payload ->> 'translationId') IN (SELECT json_array_elements_text(${JSON.stringify(translationIds)}::json))
      AND j.locked_at IS NULL
  `);
}

export const translationsRouter = router({
  get: publicProcedure
    .input(z.object({ chapterId: z.string().uuid(), language: z.string().min(1) }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(chapterTranslations)
        .where(and(
          eq(chapterTranslations.chapterId, input.chapterId),
          eq(chapterTranslations.language, input.language),
        ));
      return row ?? null;
    }),

  listForBook: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .query(async ({ input }) => {
      const bookChapters = db
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.bookId, input.bookId));
      return db
        .select({
          id: chapterTranslations.id,
          chapterId: chapterTranslations.chapterId,
          language: chapterTranslations.language,
          status: chapterTranslations.status,
          title: chapterTranslations.title,
          progress: chapterTranslations.progress,
          error: chapterTranslations.error,
          wordCount: sql<number>`coalesce(array_length(regexp_split_to_array(trim(${chapterTranslations.text}), '\s+'), 1), 0)`,
          audioStatus: chapterTranslations.audioStatus,
          audioProgress: chapterTranslations.audioProgress,
          audioError: chapterTranslations.audioError,
          audioDurationMs: chapterTranslations.audioDurationMs,
          hasAudio: sql<boolean>`${chapterTranslations.audioPath} is not null`,
        })
        .from(chapterTranslations)
        .where(and(
          inArray(chapterTranslations.chapterId, bookChapters),
          eq(chapterTranslations.language, input.language),
        ));
    }),

  detail: publicProcedure
    .input(z.object({ chapterId: z.string().uuid(), language: z.string().min(1) }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(chapterTranslations)
        .where(and(
          eq(chapterTranslations.chapterId, input.chapterId),
          eq(chapterTranslations.language, input.language),
        ));
      if (!row) throw new Error("Translation not found");

      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.chapterId));
      if (!chapter) throw new Error("Chapter not found");

      const slug = languageSlug(row.language);
      const base = `ch${String(chapter.index).padStart(3, "0")}`;
      const previews = await listChunkPreviewsIn(
        translationChunkPreviewDir(chapter.bookId, row.language, chapter.index),
        `/files/${chapter.bookId}/chunks/${slug}/${base}`,
      );
      const ranges = locateChunks(row.text, previews.map((p) => p.text ?? ""));
      const blocks = Array.isArray(chapter.sourceBlocks) ? (chapter.sourceBlocks as SourceBlock[]) : [];
      const translatedLength = Math.max(row.text?.length ?? 0, 1);
      const chunkPreviews = previews.map((preview, i) => {
        const range = ranges[i];
        if (!range) return preview;
        // Translated offsets don't map to source blocks; scale onto rawText for an approximate page.
        const rawOffset = Math.round((range.start / translatedLength) * chapter.rawText.length);
        const page = pageAtOffset(blocks, chapter.rawText.length, rawOffset) ?? chapter.pageStart ?? undefined;
        return { ...preview, start: range.start, end: range.end, ...(page !== undefined ? { page } : {}) };
      });

      return { ...row, chunkPreviews };
    }),

  languages: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db
        .select({
          language: chapterTranslations.language,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${chapterTranslations.status} = 'done')::int`,
        })
        .from(chapterTranslations)
        .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
        .where(eq(chapters.bookId, input.bookId))
        .groupBy(chapterTranslations.language)
        .orderBy(chapterTranslations.language);
    }),

  start: publicProcedure
    .input(z.object({
      chapterId: z.string().uuid(),
      language: z.string().min(1),
      restart: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.chapterId));
      if (!chapter) throw new Error("Chapter not found");

      const [existing] = await db
        .select()
        .from(chapterTranslations)
        .where(and(
          eq(chapterTranslations.chapterId, input.chapterId),
          eq(chapterTranslations.language, input.language),
        ));

      if (
        existing &&
        ["pending", "translating"].includes(existing.status) &&
        Date.now() - existing.updatedAt.getTime() < STALE_RUNNING_MS
      ) {
        throw new Error("Translation is already running");
      }

      let translationId: string;
      if (existing) {
        const reset = input.restart || existing.status === "done";
        const [updated] = await db
          .update(chapterTranslations)
          .set({
            status: "pending",
            error: null,
            updatedAt: new Date(),
            ...(reset ? { text: "", progress: null, title: null } : {}),
          })
          .where(eq(chapterTranslations.id, existing.id))
          .returning({ id: chapterTranslations.id });
        translationId = updated.id;
        await deleteQueuedTranslateJobs([translationId]);
      } else {
        const [created] = await db
          .insert(chapterTranslations)
          .values({ chapterId: input.chapterId, language: input.language })
          .returning({ id: chapterTranslations.id });
        translationId = created.id;
      }

      await db
        .update(books)
        .set({ translationLanguage: input.language, updatedAt: new Date() })
        .where(eq(books.id, chapter.bookId));

      await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Queued translation to ${input.language}`);
      await quickAddJob({ connectionString }, "translate", { translationId, bookId: chapter.bookId }, { maxAttempts: 1 });

      const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
      return row;
    }),

  processSelectedTranslations: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const rows = await db
        .select({
          chapterId: chapters.id,
          translationId: chapterTranslations.id,
          status: chapterTranslations.status,
          updatedAt: chapterTranslations.updatedAt,
        })
        .from(chapters)
        .leftJoin(chapterTranslations, and(
          eq(chapterTranslations.chapterId, chapters.id),
          eq(chapterTranslations.language, input.language),
        ))
        .where(and(eq(chapters.bookId, input.bookId), eq(chapters.selected, true)))
        .orderBy(asc(chapters.index));

      // Done chapters are skipped, suspended/failed ones resume; a fresh running one is left alone.
      const queueable = rows.filter((r) =>
        !r.translationId ||
        r.status === "failed" ||
        r.status === "suspended" ||
        (["pending", "translating"].includes(r.status!) && Date.now() - r.updatedAt!.getTime() >= STALE_RUNNING_MS),
      );
      if (queueable.length === 0) throw new Error(`No selected chapters need translation to ${input.language}`);

      const translationIds: string[] = [];
      for (const r of queueable) {
        if (r.translationId) {
          await db
            .update(chapterTranslations)
            .set({ status: "pending", error: null, updatedAt: new Date() })
            .where(eq(chapterTranslations.id, r.translationId));
          translationIds.push(r.translationId);
        } else {
          const [created] = await db
            .insert(chapterTranslations)
            .values({ chapterId: r.chapterId, language: input.language })
            .returning({ id: chapterTranslations.id });
          translationIds.push(created.id);
        }
      }

      await db
        .update(books)
        .set({ translationLanguage: input.language, updatedAt: new Date() })
        .where(eq(books.id, input.bookId));

      await deleteQueuedTranslateJobs(translationIds);
      await appendLog(input.bookId, `Queued ${translationIds.length} chapter${translationIds.length === 1 ? "" : "s"} for translation to ${input.language}`);
      for (const tid of translationIds) {
        await quickAddJob({ connectionString }, "translate", { translationId: tid, bookId: input.bookId }, { maxAttempts: 1 });
      }
      return { queued: translationIds.length };
    }),

  translateMissingTitles: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const rows = await db
        .select({ id: chapterTranslations.id })
        .from(chapterTranslations)
        .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
        .where(and(
          eq(chapters.bookId, input.bookId),
          eq(chapterTranslations.language, input.language),
          eq(chapterTranslations.status, "done"),
          sql`${chapterTranslations.title} IS NULL`,
        ));
      if (rows.length === 0) throw new Error(`No finished ${input.language} translations are missing a title`);

      await appendLog(input.bookId, `Queued ${input.language} title translation for ${rows.length} chapter${rows.length === 1 ? "" : "s"}`);
      await quickAddJob(
        { connectionString },
        "translateTitles",
        { bookId: input.bookId, language: input.language },
        { maxAttempts: 1, jobKey: `translateTitles:${input.bookId}:${input.language}` },
      );
      return { queued: rows.length };
    }),

  queueAudio: publicProcedure
    .input(z.object({ chapterId: z.string().uuid(), language: z.string().min(1), resume: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.chapterId));
      if (!chapter) throw new Error("Chapter not found");

      const [row] = await db
        .select()
        .from(chapterTranslations)
        .where(and(
          eq(chapterTranslations.chapterId, input.chapterId),
          eq(chapterTranslations.language, input.language),
        ));
      if (!row || row.status !== "done") throw new Error(`Translation to ${input.language} is not finished`);
      if (row.audioStatus === "synthesizing" || row.audioStatus === "pending") {
        throw new Error("Chapter audio is already being processed");
      }

      await db
        .update(chapterTranslations)
        .set({
          audioStatus: "pending",
          audioError: null,
          updatedAt: new Date(),
          ...(input.resume ? {} : { audioProgress: null }),
        })
        .where(eq(chapterTranslations.id, row.id));

      await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Queued ${input.language} synthesis`);
      await quickAddJob(
        { connectionString },
        "synthesizeTranslation",
        { translationId: row.id, bookId: chapter.bookId, resume: input.resume ?? false },
        { maxAttempts: 1 },
      );

      const [updated] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, row.id));
      return updated;
    }),

  processSelectedAudio: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const rows = await db
        .select({
          id: chapterTranslations.id,
          status: chapterTranslations.status,
          audioStatus: chapterTranslations.audioStatus,
          chapterIndex: chapters.index,
        })
        .from(chapterTranslations)
        .innerJoin(chapters, eq(chapterTranslations.chapterId, chapters.id))
        .where(and(
          eq(chapters.bookId, input.bookId),
          eq(chapters.selected, true),
          eq(chapterTranslations.language, input.language),
          inArray(chapterTranslations.status, ["done", "pending", "translating"]),
        ))
        .orderBy(asc(chapters.index));

      const queueable = rows.filter((r) => r.audioStatus !== "synthesizing" && r.audioStatus !== "pending");
      if (queueable.length === 0) throw new Error(`No selected chapters with a finished or in-progress ${input.language} translation to synthesize`);

      await db
        .update(chapterTranslations)
        .set({ audioStatus: "pending", audioError: null, audioProgress: null, updatedAt: new Date() })
        .where(inArray(chapterTranslations.id, queueable.map((r) => r.id)));

      // Chapters still translating only get the pending marker; the translate worker enqueues their job on completion.
      const ready = queueable.filter((r) => r.status === "done");
      const deferred = queueable.length - ready.length;
      await appendLog(
        input.bookId,
        `Queued ${queueable.length} chapter${queueable.length === 1 ? "" : "s"} for ${input.language} synthesis` +
          (deferred > 0 ? ` (${deferred} will start when translation finishes)` : ""),
      );
      for (const r of ready) {
        await quickAddJob(
          { connectionString },
          "synthesizeTranslation",
          { translationId: r.id, bookId: input.bookId },
          { maxAttempts: 1 },
        );
      }
      return { queued: queueable.length, deferred };
    }),

  stopAudio: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const bookChapters = db
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.bookId, input.bookId));

      const stopped = await db
        .update(chapterTranslations)
        .set({ audioStatus: "suspended", updatedAt: new Date() })
        .where(and(
          inArray(chapterTranslations.chapterId, bookChapters),
          eq(chapterTranslations.language, input.language),
          inArray(chapterTranslations.audioStatus, ["pending", "synthesizing"]),
        ))
        .returning({ id: chapterTranslations.id });

      await db.execute(sql`
        DELETE FROM graphile_worker._private_jobs j
        USING graphile_worker._private_tasks t
        WHERE t.id = j.task_id AND t.identifier = 'synthesizeTranslation'
          AND (j.payload ->> 'bookId') = ${input.bookId}
          AND j.locked_at IS NULL
      `);

      if (stopped.length > 0) {
        await appendLog(input.bookId, `Stopped ${input.language} synthesis (${stopped.length} chapter${stopped.length === 1 ? "" : "s"})`);
      }
      return { stopped: stopped.length };
    }),

  assemble: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [book] = await db.select().from(books).where(eq(books.id, input.bookId));
      if (!book) throw new Error("Book not found");
      if (book.status === "assembling") throw new Error("Assembly already in progress");

      await appendLog(input.bookId, `Queued ${input.language} assembly`);
      await quickAddJob({ connectionString }, "assemble", { bookId: input.bookId, language: input.language }, { maxAttempts: 1 });
      return { success: true };
    }),

  stop: publicProcedure
    .input(z.object({ chapterId: z.string().uuid(), language: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.chapterId));
      if (!chapter) throw new Error("Chapter not found");

      const [row] = await db
        .update(chapterTranslations)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(and(
          eq(chapterTranslations.chapterId, input.chapterId),
          eq(chapterTranslations.language, input.language),
          inArray(chapterTranslations.status, ["pending", "translating"]),
        ))
        .returning();

      if (row) {
        await db.execute(sql`
          DELETE FROM graphile_worker._private_jobs j
          USING graphile_worker._private_tasks t
          WHERE t.id = j.task_id AND t.identifier = 'translate'
            AND (j.payload ->> 'translationId') = ${row.id}
            AND j.locked_at IS NULL
        `);
        await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Translation stop requested`);
      }

      return row ?? null;
    }),
});
