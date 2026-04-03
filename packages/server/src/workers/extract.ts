import type { WorkerUtils } from "graphile-worker";
import { db } from "../db.ts";
import { books, chapters } from "../schema.ts";
import { eq } from "drizzle-orm";
import { extractPdf } from "../lib/marker.ts";
import { bookTmpDir } from "../lib/paths.ts";
import { appendLog } from "../lib/log.ts";

export type ExtractPayload = {
  bookId: string;
};

export async function extract(payload: ExtractPayload, { addJob }: { addJob: WorkerUtils["addJob"] }) {
  const { bookId } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  await db.update(books).set({ status: "extracting", error: null, updatedAt: new Date() }).where(eq(books.id, bookId));
  await log("Starting extraction");

  try {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new Error(`Book ${bookId} not found`);

    const tmpOut = bookTmpDir(bookId);
    const extractedChapters = await extractPdf(book.pdfPath, tmpOut, log, {
      forceOcr: book.forceOcr,
      llmChapterDetection: book.llmChapterDetection,
    });

    if (extractedChapters.length === 0) {
      throw new Error("No chapters detected in PDF");
    }

    await log(`Detected ${extractedChapters.length} chapters`);

    for (let i = 0; i < extractedChapters.length; i++) {
      const ch = extractedChapters[i];
      const wordCount = ch.text.split(/\s+/).filter(Boolean).length;
      await log(`Chapter ${i + 1}: "${ch.title}" (${wordCount.toLocaleString()} words)`);

      const [inserted] = await db
        .insert(chapters)
        .values({
          bookId,
          index: i,
          title: ch.title,
            rawText: ch.text,
            pageStart: ch.pageStart,
            pageEnd: ch.pageEnd,
            sourceBlocks: ch.sourceBlocks,
            status: book.skipSynthesis ? "suspended" : "pending",
          })
          .returning();

      if (!book.skipSynthesis) {
        await addJob("normalize", { chapterId: inserted.id, bookId }, { maxAttempts: 1 });
      }
    }

    await db
      .update(books)
      .set({ totalChapters: extractedChapters.length, updatedAt: new Date() })
      .where(eq(books.id, bookId));

    await log(
      book.skipSynthesis
        ? "Extraction complete in reader mode — chapters are suspended. Queue selected chapters when ready."
        : "Extraction complete, queuing normalization"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`Extraction failed: ${message}`);
    await db.update(books).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(books.id, bookId));
    throw err;
  }
}
