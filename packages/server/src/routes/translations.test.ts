import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../test/setup.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { eq, sql } from "drizzle-orm";

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
    const db = getDb();
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS graphile_worker`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS graphile_worker._private_jobs (
        id serial PRIMARY KEY,
        task_identifier text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        run_at timestamptz NOT NULL DEFAULT now()
      )
    `);
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
