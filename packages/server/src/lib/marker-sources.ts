import { db } from "../db.ts";
import { bookFiles, type Book } from "../schema.ts";
import { eq, asc } from "drizzle-orm";
import { bookTmpDir } from "./paths.ts";
import path from "node:path";

export type MarkerSource = {
  fileIndex: number | null;
  filename: string;
  pdfPath: string;
  outDir: string;
};

export async function listMarkerSources(book: Book): Promise<MarkerSource[]> {
  const files = await db
    .select()
    .from(bookFiles)
    .where(eq(bookFiles.bookId, book.id))
    .orderBy(asc(bookFiles.index));

  if (files.length === 0) {
    return [{ fileIndex: null, filename: book.filename, pdfPath: book.pdfPath, outDir: bookTmpDir(book.id) }];
  }

  return files.map((f) => ({
    fileIndex: f.index,
    filename: f.filename,
    pdfPath: f.pdfPath,
    outDir: path.join(bookTmpDir(book.id), `file_${f.index}`),
  }));
}
