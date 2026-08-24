import { db } from "../db.ts";
import { chapters } from "../schema.ts";
import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { normalizeChapter } from "../workers/normalize.ts";

const rows = await db
  .select()
  .from(chapters)
  .where(and(isNull(chapters.textMap), isNotNull(chapters.cleanText), isNotNull(chapters.sourceBlocks)));

let mapped = 0;
let skipped = 0;
for (const chapter of rows) {
  const { cleanText, textMap } = normalizeChapter(chapter.rawText, chapter.sourceBlocks);
  // A map that describes different text than the chapter was chunked from would point at the
  // wrong blocks, so those chapters keep the approximate page lookup.
  if (!textMap || cleanText !== chapter.cleanText) {
    skipped++;
    continue;
  }
  await db.update(chapters).set({ textMap }).where(eq(chapters.id, chapter.id));
  mapped++;
}

console.log(`Mapped ${mapped} of ${rows.length} chapter(s); ${skipped} could not be mapped exactly`);
process.exit(0);
