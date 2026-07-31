import { db } from "../db.ts";
import { chapters } from "../schema.ts";
import { eq, asc } from "drizzle-orm";
import { getBookRawText } from "./book-raw-text.ts";

// Best text for summarizing a whole book: extracted chapters (cleaned/edited) when
// available, otherwise the pdftotext raw layer.
export async function getBookSummaryText(bookId: string): Promise<string | null> {
  const rows = await db
    .select({ index: chapters.index, title: chapters.title, rawText: chapters.rawText, cleanText: chapters.cleanText, customText: chapters.customText })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.index));

  if (rows.length > 0) {
    return rows
      .map((ch) => `Chapter ${ch.index + 1}: "${ch.title}"\n\n${ch.customText ?? ch.cleanText ?? ch.rawText}`)
      .join("\n\n---\n\n");
  }

  const raw = await getBookRawText(bookId);
  return raw?.text ?? null;
}
