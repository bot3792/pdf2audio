import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq } from "drizzle-orm";
import { quickAddJob } from "graphile-worker";

const connectionString = process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";

export const chaptersRouter = router({
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");
      return chapter;
    }),

  retry: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [chapter] = await db.select().from(chapters).where(eq(chapters.id, input.id));
      if (!chapter) throw new Error("Chapter not found");

      await db
        .update(chapters)
        .set({ status: "pending", error: null, audioPath: null, durationMs: null })
        .where(eq(chapters.id, input.id));

      await db
        .update(books)
        .set({ status: "synthesizing", error: null, outputPath: null, updatedAt: new Date() })
        .where(eq(books.id, chapter.bookId));

      await quickAddJob({ connectionString }, "synthesize", {
        chapterId: input.id,
        bookId: chapter.bookId,
      });

      return { success: true };
    }),
});
