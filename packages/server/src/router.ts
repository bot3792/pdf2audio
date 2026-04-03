import { router } from "./trpc.ts";
import { booksRouter } from "./routes/books.ts";
import { chaptersRouter } from "./routes/chapters.ts";
import { bookFilesRouter } from "./routes/bookFiles.ts";

export const appRouter = router({
  books: booksRouter,
  chapters: chaptersRouter,
  bookFiles: bookFilesRouter,
});

export type AppRouter = typeof appRouter;
