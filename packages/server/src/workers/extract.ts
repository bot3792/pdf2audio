import type { WorkerUtils } from "graphile-worker";
import { db } from "../db.ts";
import { books, chapters } from "../schema.ts";
import { eq } from "drizzle-orm";
import { extractPdf } from "../lib/marker.ts";
import { bookTmpDir } from "../lib/paths.ts";

export type ExtractPayload = {
  bookId: string;
};

export async function extract(payload: ExtractPayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { bookId } = payload;

  await db.update(books).set({ status: "extracting", updatedAt: new Date() }).where(eq(books.id, bookId));

  try {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    const tmpOut = bookTmpDir(bookId);
    const extractedChapters = await extractPdf(book.pdfPath, tmpOut);

    if (extractedChapters.length === 0) {
      throw new Error("No chapters detected in PDF");
    }

    for (let i = 0; i < extractedChapters.length; i++) {
      const ch = extractedChapters[i];
      const [inserted] = await db
        .insert(chapters)
        .values({
          bookId,
          index: i,
          title: ch.title,
          rawText: ch.text,
          status: "pending",
        })
        .returning();

      await addJob("normalize", { chapterId: inserted.id, bookId });
    }

    await db
      .update(books)
      .set({ totalChapters: extractedChapters.length, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(books).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}
