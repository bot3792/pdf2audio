import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, resetDb } from "../../test/setup.ts";
import { books, chapters } from "../schema.ts";

const { mockQuickAddJob } = vi.hoisted(() => ({
  mockQuickAddJob: vi.fn(async () => {}),
}));

vi.mock("graphile-worker", () => ({
  quickAddJob: mockQuickAddJob,
}));

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { booksRouter } from "./books.ts";

describe("booksRouter.updateSettings", () => {
  beforeEach(async () => {
    await resetDb(getDb());
  });

  it("rejects unsupported voice ids", async () => {
    const db = getDb();
    const id = crypto.randomUUID();

    await db.insert(books).values({
      id,
      title: "Book",
      filename: "book.pdf",
      pdfPath: "/tmp/book.pdf",
      voice: "kokoro:af_heart",
      speed: 1.0,
    });

    const caller = booksRouter.createCaller({});

    await expect(caller.updateSettings({ id, voice: "bg-mms:nope" })).rejects.toThrow(/unsupported voice/i);
  });

  it("re-queues selected done chapters for synthesis with cleared audio metadata", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();

    await db.insert(books).values({
      id: bookId,
      title: "Book",
      filename: "book.pdf",
      pdfPath: "/tmp/book.pdf",
      voice: "bg-mms:bul",
      speed: 1.0,
    });

    await db.insert(chapters).values({
      id: chapterId,
      bookId,
      index: 0,
      title: "Chapter 1",
      rawText: "Добро утро.",
      cleanText: "Добро утро.",
      status: "done",
      selected: true,
      audioPath: "/tmp/ch000.mp3",
      durationMs: 12345,
      progress: "2/2",
      synthesizedWith: { voice: "bg-mlx:narrator", speed: null },
    });

    const caller = booksRouter.createCaller({});

    await caller.processSelected({ id: bookId });

    expect(mockQuickAddJob).toHaveBeenCalledWith(
      expect.any(Object),
      "synthesize",
      { chapterId, bookId },
      { maxAttempts: 1 }
    );

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    expect(chapter.status).toBe("pending");
    expect(chapter.audioPath).toBeNull();
    expect(chapter.durationMs).toBeNull();
    expect(chapter.progress).toBeNull();
    expect(chapter.synthesizedWith).toBeNull();
    expect(chapter.error).toBeNull();
  });
});
