import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../test/setup.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { asc, eq } from "drizzle-orm";

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { resetChaptersKeepingInserted } from "./insert-chapters.ts";

describe("resetChaptersKeepingInserted", () => {
  beforeEach(async () => {
    await resetDb(getDb());
  });

  it("deletes extraction chapters but keeps source-tagged ones at the front with audio reset", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    await db.insert(books).values({ id: bookId, title: "Book", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
    const noteChapterId = crypto.randomUUID();
    await db.insert(chapters).values([
      { bookId, index: 0, title: "Extracted", rawText: "a", status: "done", audioPath: "/x.mp3" },
      {
        id: noteChapterId,
        bookId,
        index: 1,
        title: "From note",
        rawText: "b",
        status: "done",
        audioPath: "/y.mp3",
        durationMs: 1000,
        progress: "3/3",
        source: { kind: "note", noteId: crypto.randomUUID() },
      },
      { bookId, index: 2, title: "Extracted too", rawText: "c", status: "suspended" },
    ]);
    await db.insert(chapterTranslations).values({
      chapterId: noteChapterId,
      language: "Bulgarian",
      text: "превод",
      status: "done",
      audioPath: "/t.mp3",
      audioStatus: "done",
      audioDurationMs: 500,
    });

    const kept = await resetChaptersKeepingInserted(bookId);

    expect(kept).toBe(1);
    const rows = await db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.index));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: noteChapterId,
      index: 0,
      status: "suspended",
      audioPath: null,
      durationMs: null,
      progress: null,
    });
    const [translation] = await db
      .select()
      .from(chapterTranslations)
      .where(eq(chapterTranslations.chapterId, noteChapterId));
    expect(translation).toMatchObject({ text: "превод", status: "done", audioPath: null, audioStatus: null, audioDurationMs: null });
  });

  it("returns 0 and deletes everything when no chapters are source-tagged", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    await db.insert(books).values({ id: bookId, title: "Book", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
    await db.insert(chapters).values({ bookId, index: 0, title: "Extracted", rawText: "a", status: "done" });

    expect(await resetChaptersKeepingInserted(bookId)).toBe(0);
    expect(await db.select().from(chapters).where(eq(chapters.bookId, bookId))).toHaveLength(0);
  });
});
