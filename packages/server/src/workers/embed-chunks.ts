import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { books, bookChunks, type SearchIndexJob } from "../schema.ts";
import { embedTexts } from "../lib/embeddings.ts";
import { describeError } from "../lib/errors.ts";

export type EmbedChunksPayload = { bookId: string };

const BATCH_SIZE = 32;

async function setJob(bookId: string, partial: Partial<SearchIndexJob>) {
  const [book] = await db.select({ searchIndex: books.searchIndex }).from(books).where(eq(books.id, bookId));
  if (!book) return;
  await db
    .update(books)
    .set({ searchIndex: { status: "embedding", ...book.searchIndex, ...partial, updatedAt: new Date().toISOString() } })
    .where(eq(books.id, bookId));
}

export async function embedChunks({ bookId }: EmbedChunksPayload) {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(bookChunks)
    .where(and(eq(bookChunks.bookId, bookId), isNull(bookChunks.embedding)));

  try {
    let done = 0;
    let batches = 0;
    while (true) {
      const rows = await db
        .select({ id: bookChunks.id, text: bookChunks.text })
        .from(bookChunks)
        .where(and(eq(bookChunks.bookId, bookId), isNull(bookChunks.embedding)))
        .orderBy(asc(bookChunks.createdAt))
        .limit(BATCH_SIZE);
      if (rows.length === 0) break;

      const vectors = await embedTexts(rows.map((r) => r.text));
      for (let i = 0; i < rows.length; i++) {
        await db.update(bookChunks).set({ embedding: vectors[i] }).where(eq(bookChunks.id, rows[i].id));
      }
      done += rows.length;
      if (++batches % 5 === 0) await setJob(bookId, { progress: `embedded ${done}/${total}` });
    }
    await setJob(bookId, { status: "done", progress: undefined, error: undefined });
  } catch (err) {
    await setJob(bookId, { status: "failed", error: describeError(err) });
    throw err;
  }
}
