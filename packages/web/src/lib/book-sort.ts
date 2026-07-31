import type { RouterOutputs } from "../../../server/src/router.ts";

export type BookRow = RouterOutputs["books"]["list"][number];

export type BookSortKey = "title" | "chapters" | "outputs" | "size" | "created" | "lastActivity";
export type BookSortDir = "asc" | "desc";

export const BOOK_SORT_VALUE: Record<BookSortKey, (b: BookRow) => string | number> = {
  title: (b) => b.title.toLowerCase(),
  chapters: (b) => b.chapterCount,
  outputs: (b) => b.outputs.assemblies + b.outputs.pdfs + b.outputs.epubs,
  size: (b) => b.sizeBytes,
  created: (b) => new Date(b.createdAt).getTime(),
  lastActivity: (b) => new Date(b.lastActivityAt).getTime(),
};

export function loadBookSort(): { key: BookSortKey; dir: BookSortDir } {
  const stored = localStorage.getItem("bookList.sortKey");
  const key = stored && stored in BOOK_SORT_VALUE ? (stored as BookSortKey) : "lastActivity";
  const dir: BookSortDir = localStorage.getItem("bookList.sortDir") === "asc" ? "asc" : "desc";
  return { key, dir };
}

export function saveBookSort(key: BookSortKey, dir: BookSortDir) {
  localStorage.setItem("bookList.sortKey", key);
  localStorage.setItem("bookList.sortDir", dir);
}

export function sortBooks(books: BookRow[], key: BookSortKey, dir: BookSortDir): BookRow[] {
  return [...books].sort((a, b) => {
    const va = BOOK_SORT_VALUE[key](a);
    const vb = BOOK_SORT_VALUE[key](b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return dir === "asc" ? cmp : -cmp;
  });
}
