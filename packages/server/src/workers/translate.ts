import { db } from "../db.ts";
import { chapters, chapterTranslations } from "../schema.ts";
import { eq, and, ne } from "drizzle-orm";
import { splitForTranslation, translateChunk } from "../lib/translate.ts";
import { appendLog } from "../lib/log.ts";
import { createHash } from "node:crypto";
import type { WorkerUtils } from "graphile-worker";

export type TranslatePayload = {
  translationId: string;
  bookId: string;
};

export async function translate(
  payload: TranslatePayload,
  { addJob }: { addJob: WorkerUtils["addJob"] },
) {
  const { translationId, bookId } = payload;

  const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
  if (!row) throw new Error(`Translation ${translationId} not found`);
  if (row.status === "suspended") return;

  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, row.chapterId));
  if (!chapter) throw new Error(`Chapter ${row.chapterId} not found`);

  const chLog = (msg: string) => appendLog(bookId, `[Ch ${chapter.index + 1}] ${msg}`);

  const transitioned = await db
    .update(chapterTranslations)
    .set({ status: "translating", error: null, updatedAt: new Date() })
    .where(and(eq(chapterTranslations.id, translationId), ne(chapterTranslations.status, "suspended")))
    .returning({ id: chapterTranslations.id });
  if (transitioned.length === 0) {
    await chLog("Translation skipped (stopped before start)");
    return;
  }

  try {
    const source = chapter.customText ?? chapter.cleanText ?? chapter.rawText;
    if (!source) throw new Error("Chapter has no text");

    const chunks = splitForTranslation(source);
    const sourceHash = createHash("sha256").update(source).digest("hex");

    // Resume only when the source is byte-identical to what the partial was translated from.
    let done = 0;
    const match = row.progress?.match(/^(\d+)\/(\d+)$/);
    if (row.text && match && Number(match[2]) === chunks.length && row.sourceHash === sourceHash) {
      done = Math.min(Number(match[1]), chunks.length);
    }
    let translated = done > 0 ? row.text : "";
    if (done === 0) {
      await db.update(chapterTranslations).set({ text: "", progress: null, sourceHash, updatedAt: new Date() })
        .where(eq(chapterTranslations.id, translationId));
    }

    await chLog(
      done > 0
        ? `Resuming translation to ${row.language} (${done}/${chunks.length} chunks done)`
        : `Translating "${chapter.title}" to ${row.language} (${chunks.length} chunks)`,
    );

    for (let i = done; i < chunks.length; i++) {
      const result = await translateChunk({
        text: chunks[i],
        language: row.language,
        previousTranslation: translated ? translated.slice(-1500) : undefined,
      });

      translated = translated ? `${translated}\n\n${result}` : result;

      const updated = await db
        .update(chapterTranslations)
        .set({ text: translated, progress: `${i + 1}/${chunks.length}`, updatedAt: new Date() })
        .where(and(eq(chapterTranslations.id, translationId), ne(chapterTranslations.status, "suspended")))
        .returning({ id: chapterTranslations.id });

      if (updated.length === 0) {
        await chLog(`Translation stopped — kept ${i}/${chunks.length} chunks`);
        return;
      }
    }

    const [finished] = await db
      .update(chapterTranslations)
      .set({ status: "done", updatedAt: new Date() })
      .where(and(eq(chapterTranslations.id, translationId), ne(chapterTranslations.status, "suspended")))
      .returning({ audioStatus: chapterTranslations.audioStatus });
    await chLog(`Translation to ${row.language} done`);

    // Synthesis queued while this translation was still running waits as audioStatus=pending
    if (finished?.audioStatus === "pending") {
      await chLog(`Starting queued ${row.language} synthesis`);
      await addJob("synthesizeTranslation", { translationId, bookId }, { maxAttempts: 1 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chLog(`Translation failed: ${message}`);
    await db
      .update(chapterTranslations)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(and(eq(chapterTranslations.id, translationId), ne(chapterTranslations.status, "suspended")));
    throw err;
  }
}
