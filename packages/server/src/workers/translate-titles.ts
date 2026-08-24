import { db } from "../db.ts";
import { chapters, chapterVariants } from "../schema.ts";
import { eq, and, asc, isNull } from "drizzle-orm";
import { translateTitle } from "../lib/translate.ts";
import { describeError } from "../lib/errors.ts";
import { appendLog } from "../lib/log.ts";

export type TranslateTitlesPayload = {
  bookId: string;
  language: string;
};

export async function translateTitles(payload: TranslateTitlesPayload) {
  const { bookId, language } = payload;

  const rows = await db
    .select({
      id: chapterVariants.id,
      text: chapterVariants.text,
      chapterTitle: chapters.title,
      chapterIndex: chapters.index,
    })
    .from(chapterVariants)
    .innerJoin(chapters, eq(chapterVariants.chapterId, chapters.id))
    .where(and(
      eq(chapters.bookId, bookId),
      eq(chapterVariants.key, language),
      eq(chapterVariants.status, "done"),
      eq(chapterVariants.kind, "translation"),
      isNull(chapterVariants.title),
    ))
    .orderBy(asc(chapters.index));

  if (rows.length === 0) return;

  await appendLog(bookId, `Translating ${rows.length} chapter title${rows.length === 1 ? "" : "s"} to ${language}`);

  let failed = 0;
  for (const row of rows) {
    try {
      const title = await translateTitle({
        title: row.chapterTitle,
        language,
        translatedOpening: row.text.slice(0, 1000),
      });
      await db
        .update(chapterVariants)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(chapterVariants.id, row.id), eq(chapterVariants.status, "done")));
    } catch (err) {
      failed++;
      await appendLog(bookId, `[Ch ${row.chapterIndex + 1}] Title translation failed: ${describeError(err)}`);
    }
  }

  await appendLog(bookId, `Translated ${rows.length - failed}/${rows.length} titles to ${language}`);
  if (failed > 0) throw new Error(`${failed} title translation${failed === 1 ? "" : "s"} failed`);
}
