import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { notes } from "../schema.ts";
import { eq, desc } from "drizzle-orm";

export const notesRouter = router({
  list: publicProcedure
    .input(z.object({ bookId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(notes).where(eq(notes.bookId, input.bookId)).orderBy(desc(notes.createdAt));
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(notes).where(eq(notes.id, input.id));
      return { success: true };
    }),
});
