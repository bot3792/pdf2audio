import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { books, folders } from "../schema.ts";
import { eq, asc, inArray } from "drizzle-orm";
import { folderSubtreeIds, folderAncestors } from "../lib/folders.ts";
import { deleteBook } from "../lib/delete-book.ts";

export const foldersRouter = router({
  list: publicProcedure.query(async () => {
    return db
      .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
      .from(folders)
      .orderBy(asc(folders.name));
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(200),
      parentId: z.string().uuid().nullable().default(null),
    }))
    .mutation(async ({ input }) => {
      if (input.parentId) {
        const [parent] = await db.select().from(folders).where(eq(folders.id, input.parentId));
        if (!parent) throw new Error("Parent folder not found");
      }
      const [folder] = await db
        .insert(folders)
        .values({ name: input.name, parentId: input.parentId })
        .returning();
      return folder;
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200) }))
    .mutation(async ({ input }) => {
      await db
        .update(folders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(folders.id, input.id));
      return { success: true };
    }),

  move: publicProcedure
    .input(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      const [folder] = await db.select().from(folders).where(eq(folders.id, input.id));
      if (!folder) throw new Error("Folder not found");
      if (input.parentId) {
        const subtree = await folderSubtreeIds(input.id);
        if (subtree.includes(input.parentId)) {
          throw new Error("Cannot move a folder into itself or its own subtree");
        }
        const [target] = await db.select().from(folders).where(eq(folders.id, input.parentId));
        if (!target) throw new Error("Target folder not found");
      }
      await db
        .update(folders)
        .set({ parentId: input.parentId, updatedAt: new Date() })
        .where(eq(folders.id, input.id));
      return { success: true };
    }),

  path: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return folderAncestors(input.id);
    }),

  deleteStats: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const subtree = await folderSubtreeIds(input.id);
      if (subtree.length === 0) throw new Error("Folder not found");
      const bookRows = await db
        .select({ id: books.id })
        .from(books)
        .where(inArray(books.folderId, subtree));
      return { folderCount: subtree.length, bookCount: bookRows.length };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const subtree = await folderSubtreeIds(input.id);
      if (subtree.length === 0) throw new Error("Folder not found");
      const bookRows = await db
        .select({ id: books.id })
        .from(books)
        .where(inArray(books.folderId, subtree));
      for (const { id } of bookRows) {
        await deleteBook(id);
      }
      await db.delete(folders).where(eq(folders.id, input.id));
      return { deletedBooks: bookRows.length, deletedFolders: subtree.length };
    }),
});
