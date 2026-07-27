import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb, ensureGraphileTables } from "../../test/setup.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { eq } from "drizzle-orm";

const { mockQuickAddJob } = vi.hoisted(() => ({ mockQuickAddJob: vi.fn(async () => {}) }));
vi.mock("graphile-worker", () => ({ quickAddJob: mockQuickAddJob }));

vi.mock("../lib/log.ts", () => ({
  appendLog: vi.fn(async () => {}),
}));

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { translationsRouter } from "./translations.ts";

const caller = translationsRouter.createCaller({});

async function insertFixture(db: ReturnType<typeof getDb>) {
  const bookId = crypto.randomUUID();
  await db.insert(books).values({ id: bookId, title: "Book", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
  const chapterId = crypto.randomUUID();
  await db.insert(chapters).values({ id: chapterId, bookId, index: 0, title: "Ch", rawText: "Some text." });
  return { bookId, chapterId };
}

describe("translations router", () => {
  // stop() clears queued jobs from the graphile-worker queue, which only exists once a worker has run
  beforeAll(async () => {
    await ensureGraphileTables(getDb());
  });

  beforeEach(async () => {
    await resetDb(getDb());
    mockQuickAddJob.mockClear();
  });

  it("start creates a row, stores the book language, and enqueues a job", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);

    const row = await caller.start({ chapterId, language: "Bulgarian" });

    expect(row?.status).toBe("pending");
    expect(row?.language).toBe("Bulgarian");
    expect(mockQuickAddJob).toHaveBeenCalledWith(
      expect.anything(),
      "translate",
      { translationId: row!.id, bookId },
      { maxAttempts: 1 },
    );
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    expect(book.translationLanguage).toBe("Bulgarian");
  });

  it("start rejects when a fresh translation is already running", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({ chapterId, language: "Bulgarian", status: "translating" });

    await expect(caller.start({ chapterId, language: "Bulgarian" })).rejects.toThrow("already running");
    expect(mockQuickAddJob).not.toHaveBeenCalled();
  });

  it("start resumes a suspended translation keeping its text", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({
      chapterId,
      language: "Bulgarian",
      status: "suspended",
      text: "partial",
      progress: "1/3",
    });

    const row = await caller.start({ chapterId, language: "Bulgarian" });

    expect(row?.status).toBe("pending");
    expect(row?.text).toBe("partial");
    expect(row?.progress).toBe("1/3");
  });

  it("start with restart clears previous text", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({
      chapterId,
      language: "Bulgarian",
      status: "suspended",
      text: "partial",
      progress: "1/3",
    });

    const row = await caller.start({ chapterId, language: "Bulgarian", restart: true });

    expect(row?.text).toBe("");
    expect(row?.progress).toBeNull();
  });

  it("stop suspends a running translation and clears queued jobs", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({ chapterId, language: "Bulgarian", status: "translating" });

    const row = await caller.stop({ chapterId, language: "Bulgarian" });

    expect(row?.status).toBe("suspended");
  });

  it("stop is a no-op for a finished translation", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({ chapterId, language: "Bulgarian", status: "done", text: "done text" });

    const row = await caller.stop({ chapterId, language: "Bulgarian" });

    expect(row).toBeNull();
    const [kept] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.chapterId, chapterId));
    expect(kept.status).toBe("done");
  });

  it("queueAudio enqueues synthesis for a finished translation", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    const [row] = await db
      .insert(chapterTranslations)
      .values({ chapterId, language: "Bulgarian", status: "done", text: "bg text" })
      .returning();

    const updated = await caller.queueAudio({ chapterId, language: "Bulgarian" });

    expect(updated?.audioStatus).toBe("pending");
    expect(mockQuickAddJob).toHaveBeenCalledWith(
      expect.anything(),
      "synthesizeTranslation",
      { translationId: row.id, bookId, resume: false },
      { maxAttempts: 1 },
    );
  });

  it("queueAudio rejects unfinished translations", async () => {
    const db = getDb();
    const { chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({ chapterId, language: "Bulgarian", status: "suspended", text: "partial" });

    await expect(caller.queueAudio({ chapterId, language: "Bulgarian" })).rejects.toThrow("not finished");
    expect(mockQuickAddJob).not.toHaveBeenCalled();
  });

  it("processSelectedTranslations queues selected chapters without a finished translation", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    const doneId = crypto.randomUUID();
    await db.insert(chapters).values({ id: doneId, bookId, index: 1, title: "Ch2", rawText: "Second." });
    const suspendedId = crypto.randomUUID();
    await db.insert(chapters).values({ id: suspendedId, bookId, index: 2, title: "Ch3", rawText: "Third." });
    const unselectedId = crypto.randomUUID();
    await db.insert(chapters).values({ id: unselectedId, bookId, index: 3, title: "Ch4", rawText: "Fourth.", selected: false });

    await db.insert(chapterTranslations).values([
      { chapterId: doneId, language: "Bulgarian", status: "done", text: "bg" },
      { chapterId: suspendedId, language: "Bulgarian", status: "suspended", text: "partial", progress: "1/3" },
    ]);

    const result = await caller.processSelectedTranslations({ bookId, language: "Bulgarian" });

    expect(result.queued).toBe(2);
    expect(mockQuickAddJob).toHaveBeenCalledTimes(2);
    const [created] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.chapterId, chapterId));
    expect(created.status).toBe("pending");
    const [resumed] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.chapterId, suspendedId));
    expect(resumed.status).toBe("pending");
    expect(resumed.text).toBe("partial");
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    expect(book.translationLanguage).toBe("Bulgarian");
  });

  it("processSelectedTranslations leaves a fresh running translation alone", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({ chapterId, language: "Bulgarian", status: "translating" });

    await expect(caller.processSelectedTranslations({ bookId, language: "Bulgarian" })).rejects.toThrow("No selected chapters");
    expect(mockQuickAddJob).not.toHaveBeenCalled();
  });

  it("processSelectedAudio queues only selected chapters with finished translations", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    const otherChapterId = crypto.randomUUID();
    await db.insert(chapters).values({ id: otherChapterId, bookId, index: 1, title: "Ch2", rawText: "More text.", selected: false });
    const unselectedDoneId = crypto.randomUUID();
    await db.insert(chapters).values({ id: unselectedDoneId, bookId, index: 2, title: "Ch3", rawText: "Third.", selected: true });

    await db.insert(chapterTranslations).values([
      { chapterId, language: "Bulgarian", status: "done", text: "bg" },
      { chapterId: otherChapterId, language: "Bulgarian", status: "done", text: "bg2" },
      { chapterId: unselectedDoneId, language: "Bulgarian", status: "suspended", text: "partial" },
    ]);

    const result = await caller.processSelectedAudio({ bookId, language: "Bulgarian" });

    expect(result.queued).toBe(1);
    expect(mockQuickAddJob).toHaveBeenCalledTimes(1);
  });

  it("processSelectedAudio marks still-translating chapters pending without enqueueing a job", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    const doneId = crypto.randomUUID();
    await db.insert(chapters).values({ id: doneId, bookId, index: 1, title: "Ch2", rawText: "Second." });

    await db.insert(chapterTranslations).values([
      { chapterId, language: "Bulgarian", status: "translating", text: "partial" },
      { chapterId: doneId, language: "Bulgarian", status: "done", text: "bg" },
    ]);

    const result = await caller.processSelectedAudio({ bookId, language: "Bulgarian" });

    expect(result.queued).toBe(2);
    expect(result.deferred).toBe(1);
    expect(mockQuickAddJob).toHaveBeenCalledTimes(1);
    const [translating] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.chapterId, chapterId));
    expect(translating.audioStatus).toBe("pending");
    expect(translating.status).toBe("translating");
  });

  it("stopAudio suspends running audio and reports the count", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values({
      chapterId,
      language: "Bulgarian",
      status: "done",
      text: "bg",
      audioStatus: "synthesizing",
    });

    const result = await caller.stopAudio({ bookId, language: "Bulgarian" });

    expect(result.stopped).toBe(1);
    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.chapterId, chapterId));
    expect(row.audioStatus).toBe("suspended");
  });

  it("languages aggregates per-language translation counts", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values([
      { chapterId, language: "Bulgarian", status: "done", text: "bg" },
      { chapterId, language: "German", status: "translating" },
    ]);

    const result = await caller.languages({ bookId });

    expect(result).toEqual([
      { language: "Bulgarian", total: 1, done: 1 },
      { language: "German", total: 1, done: 0 },
    ]);
  });

  it("get returns the row and listForBook filters by language", async () => {
    const db = getDb();
    const { bookId, chapterId } = await insertFixture(db);
    await db.insert(chapterTranslations).values([
      { chapterId, language: "Bulgarian", status: "done", text: "bg" },
      { chapterId, language: "German", status: "pending" },
    ]);

    const row = await caller.get({ chapterId, language: "Bulgarian" });
    expect(row?.text).toBe("bg");

    const list = await caller.listForBook({ bookId, language: "Bulgarian" });
    expect(list).toHaveLength(1);
    expect(list[0].language).toBe("Bulgarian");
  });
});
