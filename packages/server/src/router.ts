import { router } from "./trpc.ts";
import { booksRouter } from "./routes/books.ts";
import { chaptersRouter } from "./routes/chapters.ts";

export const appRouter = router({
  books: booksRouter,
  chapters: chaptersRouter,
});

export type AppRouter = typeof appRouter;
