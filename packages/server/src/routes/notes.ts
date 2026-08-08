import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, chapters, notes } from "../schema.ts";
import { eq, desc, max } from "drizzle-orm";
import { appendLog } from "../lib/log.ts";

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

  toChapter: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [note] = await db.select().from(notes).where(eq(notes.id, input.id));
      if (!note) throw new Error("Note not found");

      const [{ maxIndex }] = await db
        .select({ maxIndex: max(chapters.index) })
        .from(chapters)
        .where(eq(chapters.bookId, note.bookId));
      const index = maxIndex != null ? maxIndex + 1 : 0;
      const title = note.prompt.length > 100 ? `${note.prompt.slice(0, 100).trimEnd()}…` : note.prompt;

      const [chapter] = await db
        .insert(chapters)
        .values({
          bookId: note.bookId,
          index,
          title,
          rawText: note.result,
          source: { kind: "note", noteId: note.id },
          status: "suspended",
        })
        .returning({ id: chapters.id });

      await db.update(books).set({ totalChapters: index + 1, updatedAt: new Date() }).where(eq(books.id, note.bookId));
      await appendLog(note.bookId, `Added note "${title}" as chapter ${index + 1}`);
      return { chapterId: chapter.id, index };
    }),
});
