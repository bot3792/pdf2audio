import type { inferRouterOutputs } from "@trpc/server";
import { router } from "./trpc.ts";
import { booksRouter } from "./routes/books.ts";
import { chaptersRouter } from "./routes/chapters.ts";
import { bookFilesRouter } from "./routes/bookFiles.ts";
import { translationsRouter } from "./routes/translations.ts";
import { notesRouter } from "./routes/notes.ts";

export const appRouter = router({
  books: booksRouter,
  chapters: chaptersRouter,
  bookFiles: bookFilesRouter,
  translations: translationsRouter,
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
