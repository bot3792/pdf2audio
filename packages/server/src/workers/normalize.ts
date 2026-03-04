import type { WorkerUtils } from "graphile-worker";
import { db } from "../db.ts";
import { chapters } from "../schema.ts";
import { and, eq, ne } from "drizzle-orm";
import { normalizeForTts } from "../lib/normalizer.ts";
import { appendLog } from "../lib/log.ts";

export type NormalizePayload = {
  chapterId: string;
  bookId: string;
};

export async function normalize(payload: NormalizePayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { chapterId, bookId } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  try {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
    if (chapter.status === "suspended") {
      await log(`[Ch ${chapter.index + 1}] Skipped normalize (suspended)`);
      return;
    }

    const updated = await db
      .update(chapters)
      .set({ status: "normalizing", error: null })
      .where(and(eq(chapters.id, chapterId), ne(chapters.status, "suspended")))
      .returning({ id: chapters.id });

    if (updated.length === 0) {
      await log(`[Ch ${chapter.index + 1}] Skipped normalize (suspended)`);
      return;
    }

    await log(`Normalizing chapter ${chapter.index + 1}: "${chapter.title}"`);

    const cleanText = normalizeForTts(chapter.rawText);

    const [latest] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!latest || latest.status === "suspended") {
      await log(`[Ch ${chapter.index + 1}] Skipped synth queue (suspended)`);
      return;
    }

    await db
      .update(chapters)
      .set({ cleanText, status: "pending" })
      .where(eq(chapters.id, chapterId));

    await addJob("synthesize", { chapterId, bookId }, { maxAttempts: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`Normalization failed for chapter ${chapterId}: ${message}`);
    await db.update(chapters).set({ status: "failed", error: message }).where(eq(chapters.id, chapterId));
    throw err;
  }
}
