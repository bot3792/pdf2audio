import { db } from "../db.ts";
import { chapters, type ChapterSource } from "../schema.ts";
import { appendLog } from "./log.ts";

export async function insertSuspendedChapters(
  bookId: string,
  detected: { title: string; text: string; pageStart: number | null; pageEnd: number | null; sourceBlocks: unknown; source?: ChapterSource }[],
  chapterOffset: number,
  sourceFileIndex: number | null,
) {
  for (let i = 0; i < detected.length; i++) {
    const ch = detected[i];
    const globalIndex = chapterOffset + i;
    const wordCount = ch.text.split(/\s+/).filter(Boolean).length;
    await appendLog(bookId, `Chapter ${globalIndex + 1}: "${ch.title}" (${wordCount.toLocaleString()} words)`);

    await db
      .insert(chapters)
      .values({
        bookId,
        index: globalIndex,
        title: ch.title,
        rawText: ch.text,
        pageStart: ch.pageStart,
        pageEnd: ch.pageEnd,
        sourceBlocks: ch.sourceBlocks,
        sourceFileIndex,
        ...(ch.source ? { source: ch.source } : {}),
        status: "suspended",
      });
  }
}
