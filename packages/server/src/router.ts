import type { inferRouterOutputs } from "@trpc/server";
import { router } from "./trpc.ts";
import { booksRouter } from "./routes/books.ts";
import { chaptersRouter } from "./routes/chapters.ts";
import { bookFilesRouter } from "./routes/bookFiles.ts";
import { variantsRouter } from "./routes/variants.ts";
import { notesRouter } from "./routes/notes.ts";
import { foldersRouter } from "./routes/folders.ts";
import { profilesRouter } from "./routes/profiles.ts";
import { searchRouter } from "./routes/search.ts";
import { sayVoicesRouter } from "./routes/say-voices.ts";
import { cartesiaVoicesRouter } from "./routes/cartesia-voices.ts";
import { pocketVoicesRouter } from "./routes/pocket-voices.ts";

export const appRouter = router({
  books: booksRouter,
  folders: foldersRouter,
  profiles: profilesRouter,
  chapters: chaptersRouter,
  bookFiles: bookFilesRouter,
  variants: variantsRouter,
  notes: notesRouter,
  search: searchRouter,
  sayVoices: sayVoicesRouter,
  cartesiaVoices: cartesiaVoicesRouter,
  pocketVoices: pocketVoicesRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
