import type { WorkerUtils } from "graphile-worker";
import { db } from "../db.ts";
import { chapters, books } from "../schema.ts";
import { eq } from "drizzle-orm";
import { normalizeForTts } from "../lib/normalizer.ts";

export type NormalizePayload = {
  chapterId: string;
  bookId: string;
};

export async function normalize(payload: NormalizePayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { chapterId, bookId } = payload;

  await db.update(chapters).set({ status: "normalizing" }).where(eq(chapters.id, chapterId));

  try {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);

    const cleanText = normalizeForTts(chapter.rawText);

    await db
      .update(chapters)
      .set({ cleanText, status: "pending" })
      .where(eq(chapters.id, chapterId));

    await addJob("synthesize", { chapterId, bookId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(chapters).set({ status: "failed", error: message }).where(eq(chapters.id, chapterId));
    await db.update(books).set({ status: "failed", error: `Chapter "${chapterId}" normalization failed: ${message}`, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}
