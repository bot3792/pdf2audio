import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { chapters } from "../schema.ts";
import { eq, inArray } from "drizzle-orm";
import { appendLog } from "../lib/log.ts";
import { quickAddJob } from "graphile-worker";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

export const chaptersRouter = router({
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");
      return chapter;
    }),

  queue: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      if (chapter.status === "synthesizing" || chapter.status === "normalizing") {
        throw new Error("Chapter is already being processed");
      }

      await db
        .update(chapters)
        .set({ status: "pending", error: null, audioPath: null, durationMs: null })
        .where(eq(chapters.id, input.id));

      if (chapter.cleanText) {
        await quickAddJob({ connectionString }, "synthesize", {
          chapterId: input.id,
          bookId: chapter.bookId,
        }, { maxAttempts: 1 });
      } else {
        await quickAddJob({ connectionString }, "normalize", {
          chapterId: input.id,
          bookId: chapter.bookId,
        }, { maxAttempts: 1 });
      }

      await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Queued`);
      return { success: true };
    }),

  suspend: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      if (chapter.status === "done") {
        throw new Error("Cannot suspend a completed chapter");
      }
      if (chapter.status === "synthesizing" || chapter.status === "normalizing") {
        throw new Error("Cannot suspend a chapter that is actively processing");
      }

      await db
        .update(chapters)
        .set({ status: "suspended", error: null })
        .where(eq(chapters.id, input.id));

      await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] Suspended`);
      return { success: true };
    }),

  setSelected: publicProcedure
    .input(z.object({ id: z.string().uuid(), selected: z.boolean() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      await db
        .update(chapters)
        .set({ selected: input.selected })
        .where(eq(chapters.id, input.id));

      return { success: true };
    }),

  setSelectedBatch: publicProcedure
    .input(z.object({ ids: z.array(z.string().uuid()), selected: z.boolean() }))
    .mutation(async ({ input }) => {
      if (input.ids.length === 0) return { success: true };
      await db
        .update(chapters)
        .set({ selected: input.selected })
        .where(inArray(chapters.id, input.ids));
      return { success: true };
    }),

  setAllSelected: publicProcedure
    .input(z.object({ bookId: z.string().uuid(), selected: z.boolean() }))
    .mutation(async ({ input }) => {
      await db
        .update(chapters)
        .set({ selected: input.selected })
        .where(eq(chapters.bookId, input.bookId));

      return { success: true };
    }),
});
