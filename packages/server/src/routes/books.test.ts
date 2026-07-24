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

vi.mock("../lib/marker.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marker.ts")>();
  return { ...actual, collectBlocksFromMarkerOutput: vi.fn() };
});

import { booksRouter } from "./books.ts";
import { collectBlocksFromMarkerOutput, type FlatBlock } from "../lib/marker.ts";

const mockCollectBlocks = vi.mocked(collectBlocksFromMarkerOutput);

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

function block(type: string, text: string, page: number): FlatBlock {
  return { type, text, hierarchy: null, page, included: true };
}

const structureBlocks = [
  block("Text", "Front matter words here", 1),
  block("SectionHeader", "Chapter 1 Beginning", 2),
  block("Text", "one two three four five", 3),
  block("SectionHeader", "Chapter 2 Middle", 10),
  block("Text", "six seven eight", 11),
];

async function insertStructureBook(db: ReturnType<typeof getDb>) {
  const bookId = crypto.randomUUID();
  await db.insert(books).values({
    id: bookId,
    title: "Book",
    filename: "book.pdf",
    pdfPath: "/tmp/book.pdf",
  });
  await db.insert(chapters).values({
    bookId,
    index: 0,
    title: "Chapter 1 Beginning",
    rawText: "old",
    pageStart: 2,
    status: "suspended",
  });
  return bookId;
}

describe("booksRouter.structure", () => {
  beforeEach(async () => {
    await resetDb(getDb());
    mockCollectBlocks.mockReset();
  });

  it("returns the heading outline with word offsets and current boundaries", async () => {
    const bookId = await insertStructureBook(getDb());
    mockCollectBlocks.mockResolvedValue(structureBlocks);

    const caller = booksRouter.createCaller({});
    const { files } = await caller.structure({ id: bookId });

    expect(files).toHaveLength(1);
    expect(files[0].fileIndex).toBeNull();
    expect(files[0].totalWords).toBe(18);
    expect(files[0].totalPages).toBe(11);
    expect(files[0].headings).toEqual([
      { blockIndex: 1, page: 2, level: null, text: "Chapter 1 Beginning", wordsBefore: 4, isChapterStart: true },
      { blockIndex: 3, page: 10, level: null, text: "Chapter 2 Middle", wordsBefore: 12, isChapterStart: false },
    ]);
  });

  it("flags files whose extraction output is missing", async () => {
    const bookId = await insertStructureBook(getDb());
    mockCollectBlocks.mockRejectedValue(new Error("no marker output"));

    const caller = booksRouter.createCaller({});
    const { files } = await caller.structure({ id: bookId });

    expect(files[0].missing).toBe(true);
    expect(files[0].headings).toEqual([]);
  });
});

describe("booksRouter.applyChapterBoundaries", () => {
  beforeEach(async () => {
    await resetDb(getDb());
    mockCollectBlocks.mockReset();
    mockQuickAddJob.mockReset();
  });

  it("replaces chapters by slicing at the chosen block indices", async () => {
    const db = getDb();
    const bookId = await insertStructureBook(db);
    mockCollectBlocks.mockResolvedValue(structureBlocks);

    const caller = booksRouter.createCaller({});
    const updated = await caller.applyChapterBoundaries({
      id: bookId,
      boundaries: [
        { fileIndex: null, blockIndex: 1 },
        { fileIndex: null, blockIndex: 3 },
      ],
    });

    const chs = await db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(chapters.index);
    expect(chs.map((c) => c.title)).toEqual(["Chapter 1 Beginning", "Chapter 2 Middle"]);
    expect(chs.every((c) => c.status === "suspended")).toBe(true);
    expect(chs.map((c) => [c.pageStart, c.pageEnd])).toEqual([[2, 3], [10, 11]]);

    expect(updated.chapterDetection).toBe("manual");
    expect(updated.totalChapters).toBe(2);
    expect(updated.chapterProposal).toBeNull();
    expect(updated.status).toBe("pending");
  });

  it("rejects out-of-range block indices without touching existing chapters", async () => {
    const db = getDb();
    const bookId = await insertStructureBook(db);
    mockCollectBlocks.mockResolvedValue(structureBlocks);

    const caller = booksRouter.createCaller({});
    await expect(
      caller.applyChapterBoundaries({ id: bookId, boundaries: [{ fileIndex: null, blockIndex: 99 }] })
    ).rejects.toThrow(/out of range/);

    const chs = await db.select().from(chapters).where(eq(chapters.bookId, bookId));
    expect(chs).toHaveLength(1);
    expect(chs[0].title).toBe("Chapter 1 Beginning");
  });
});

describe("booksRouter.proposeChapters", () => {
  beforeEach(async () => {
    await resetDb(getDb());
    mockQuickAddJob.mockReset();
  });

  it("stores a running proposal and enqueues the propose job", async () => {
    const bookId = await insertStructureBook(getDb());

    const caller = booksRouter.createCaller({});
    const updated = await caller.proposeChapters({ id: bookId, method: "deterministic" });

    expect(updated.chapterProposal?.status).toBe("running");
    expect(updated.chapterProposal?.method).toBe("deterministic");
    expect(mockQuickAddJob).toHaveBeenCalledWith(
      expect.any(Object),
      "propose",
      { bookId, method: "deterministic" },
      { maxAttempts: 1 }
    );
  });

  it("rejects while a fresh proposal is still running", async () => {
    const db = getDb();
    const bookId = await insertStructureBook(db);
    await db
      .update(books)
      .set({ chapterProposal: { status: "running", method: "llm", createdAt: new Date().toISOString() } })
      .where(eq(books.id, bookId));

    const caller = booksRouter.createCaller({});
    await expect(caller.proposeChapters({ id: bookId, method: "llm" })).rejects.toThrow(/already running/);
  });
});
