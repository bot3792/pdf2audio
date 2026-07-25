import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { eq, and, inArray, sql } from "drizzle-orm";
import { quickAddJob } from "graphile-worker";
import { appendLog } from "../lib/log.ts";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

const STALE_RUNNING_MS = 15 * 60_000;

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
          progress: chapterTranslations.progress,
          error: chapterTranslations.error,
        })
        .from(chapterTranslations)
        .where(and(
          inArray(chapterTranslations.chapterId, bookChapters),
          eq(chapterTranslations.language, input.language),
        ));
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
            ...(reset ? { text: "", progress: null } : {}),
          })
          .where(eq(chapterTranslations.id, existing.id))
          .returning({ id: chapterTranslations.id });
        translationId = updated.id;
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
          DELETE FROM graphile_worker._private_jobs
          WHERE task_identifier = 'translate'
            AND (payload ->> 'translationId') = ${row.id}
            AND run_at > now()
        `);
        await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Translation stop requested`);
      }

      return row ?? null;
    }),
});
