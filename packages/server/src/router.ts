import type { inferRouterOutputs } from "@trpc/server";
import { router } from "./trpc.ts";
import { booksRouter } from "./routes/books.ts";
import { chaptersRouter } from "./routes/chapters.ts";
import { bookFilesRouter } from "./routes/bookFiles.ts";
import { translationsRouter } from "./routes/translations.ts";
import { notesRouter } from "./routes/notes.ts";
import { foldersRouter } from "./routes/folders.ts";
import { profilesRouter } from "./routes/profiles.ts";
import { searchRouter } from "./routes/search.ts";

export const appRouter = router({
  books: booksRouter,
  folders: foldersRouter,
  profiles: profilesRouter,
  chapters: chaptersRouter,
  bookFiles: bookFilesRouter,
  translations: translationsRouter,
  notes: notesRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
