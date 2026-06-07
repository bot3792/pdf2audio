import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, chapters } from "../schema.ts";
import { eq, and, inArray } from "drizzle-orm";
import { appendLog } from "../lib/log.ts";
import { quickAddJob } from "graphile-worker";
import { env } from "../env.ts";
import { listChapterChunkPreviews, locateChunks } from "../lib/chunk-previews.ts";
import { removeChapterArtifacts } from "../lib/chapter-artifacts.ts";

const connectionString = env.DATABASE_URL;

export const chaptersRouter = router({
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      // The synthesized text — and therefore what chunk offsets point into — follows this priority.
      const chunkTextSource = chapter.customText ? "custom" : chapter.cleanText ? "clean" : "raw";
      const sourceText = chapter.customText ?? chapter.cleanText ?? chapter.rawText;

      const previews = await listChapterChunkPreviews(chapter.bookId, chapter.index);
      const ranges = locateChunks(sourceText, previews.map((p) => p.text ?? ""));
      const chunkPreviews = previews.map((preview, i) => ({
        ...preview,
        ...(ranges[i] ? { start: ranges[i].start, end: ranges[i].end } : {}),
      }));

      return {
        ...chapter,
        chunkTextSource,
        chunkPreviews,
      };
    }),

  queue: publicProcedure
    .input(z.object({ id: z.string().uuid(), resume: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      if (chapter.status === "synthesizing" || chapter.status === "normalizing") {
        throw new Error("Chapter is already being processed");
      }

      // Resume reuses already-synthesized chunk previews; keep `progress` so the count survives.
      await db
        .update(chapters)
        .set({ status: "pending", error: null, audioPath: null, durationMs: null, synthesizedWith: null })
        .where(eq(chapters.id, input.id));

      if (chapter.cleanText) {
        await quickAddJob({ connectionString }, "synthesize", {
          chapterId: input.id,
          bookId: chapter.bookId,
          resume: input.resume ?? false,
        }, { maxAttempts: 1 });
      } else {
        await quickAddJob({ connectionString }, "normalize", {
          chapterId: input.id,
          bookId: chapter.bookId,
        }, { maxAttempts: 1 });
      }

      await appendLog(chapter.bookId, `[Ch ${chapter.index + 1}] ${input.resume ? "Resuming" : "Queued"}`);
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

  rename: publicProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await db.update(chapters).set({ title: input.title }).where(eq(chapters.id, input.id));
      return { success: true };
    }),

  updateText: publicProcedure
    .input(z.object({ id: z.string().uuid(), customText: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      await db
        .update(chapters)
        .set({ customText: input.customText })
        .where(eq(chapters.id, input.id));

      return { success: true };
    }),

  resetText: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      await db
        .update(chapters)
        .set({ customText: null })
        .where(eq(chapters.id, input.id));

      return { success: true };
    }),

  reorder: publicProcedure
    .input(z.object({
      bookId: z.string().uuid(),
      chapterIds: z.array(z.string().uuid()),
    }))
    .mutation(async ({ input }) => {
      // chapterIds is the new order — index 0 gets index=0, index 1 gets index=1, etc.
      for (let i = 0; i < input.chapterIds.length; i++) {
        await db
          .update(chapters)
          .set({ index: i })
          .where(and(eq(chapters.id, input.chapterIds[i]), eq(chapters.bookId, input.bookId)));
      }
      return { success: true };
    }),

  deleteSelected: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const selected = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.bookId, input.bookId), eq(chapters.selected, true)));

      const active = selected.filter((c) => c.status === "synthesizing" || c.status === "normalizing");
      if (active.length > 0) {
        throw new Error(`Cannot delete ${active.length} chapter(s) that are actively processing`);
      }

      for (const ch of selected) {
        await removeChapterArtifacts({ bookId: ch.bookId, index: ch.index, audioPath: ch.audioPath });
      }

      await db
        .delete(chapters)
        .where(and(eq(chapters.bookId, input.bookId), eq(chapters.selected, true)));

      // Update total count
      const remaining = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.bookId, input.bookId));
      await db.update(books).set({ totalChapters: remaining.length, updatedAt: new Date() }).where(eq(books.id, input.bookId));

      await appendLog(input.bookId, `Deleted ${selected.length} selected chapter(s)`);
      return { success: true };
    }),
});
