import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../test/setup.ts";
import { books, chapters, chapterTranslations } from "../schema.ts";
import { eq } from "drizzle-orm";

vi.mock("../lib/translate.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/translate.ts")>();
  return { ...actual, translateChunk: vi.fn() };
});

vi.mock("../lib/log.ts", () => ({
  appendLog: vi.fn(async () => {}),
}));

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { translate } from "./translate.ts";
import { translateChunk, splitForTranslation } from "../lib/translate.ts";
import { createHash } from "node:crypto";

const mockTranslateChunk = vi.mocked(translateChunk);

const PARA = "One sentence here. ".repeat(60).trim();
const SOURCE = [PARA, PARA, PARA].join("\n\n");

const SOURCE_HASH = createHash("sha256").update(SOURCE).digest("hex");

async function insertFixture(
  db: ReturnType<typeof getDb>,
  opts?: { status?: "pending" | "suspended"; text?: string; progress?: string; sourceHash?: string },
) {
  const bookId = crypto.randomUUID();
  await db.insert(books).values({ id: bookId, title: "Book", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
  const chapterId = crypto.randomUUID();
  await db.insert(chapters).values({ id: chapterId, bookId, index: 0, title: "Ch", rawText: SOURCE });
  const [row] = await db
    .insert(chapterTranslations)
    .values({
      chapterId,
      language: "Bulgarian",
      status: opts?.status ?? "pending",
      text: opts?.text ?? "",
      progress: opts?.progress,
      sourceHash: opts?.sourceHash,
    })
    .returning();
  return { bookId, chapterId, translationId: row.id };
}

describe("translate worker", () => {
  beforeEach(async () => {
    await resetDb(getDb());
    mockTranslateChunk.mockReset();
  });

  it("translates all chunks and accumulates text", async () => {
    const db = getDb();
    const { bookId, translationId } = await insertFixture(db);
    const total = splitForTranslation(SOURCE).length;
    mockTranslateChunk.mockImplementation(async ({ text }) => `BG(${text.slice(0, 10)})`);

    await translate({ translationId, bookId });

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("done");
    expect(row.progress).toBe(`${total}/${total}`);
    expect(row.text.split("\n\n")).toHaveLength(total);
    expect(mockTranslateChunk).toHaveBeenCalledTimes(total);
  });

  it("stops mid-run and keeps completed chunks when suspended", async () => {
    const db = getDb();
    const { bookId, translationId } = await insertFixture(db);
    const total = splitForTranslation(SOURCE).length;
    expect(total).toBeGreaterThan(1);

    let calls = 0;
    mockTranslateChunk.mockImplementation(async () => {
      calls++;
      if (calls === 2) {
        await db
          .update(chapterTranslations)
          .set({ status: "suspended" })
          .where(eq(chapterTranslations.id, translationId));
      }
      return `BG-${calls}`;
    });

    await translate({ translationId, bookId });

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("suspended");
    expect(row.text).toBe("BG-1");
    expect(row.progress).toBe(`1/${total}`);
    expect(mockTranslateChunk).toHaveBeenCalledTimes(2);
  });

  it("resumes from saved progress without re-translating done chunks", async () => {
    const db = getDb();
    const total = splitForTranslation(SOURCE).length;
    const { bookId, translationId } = await insertFixture(db, {
      text: "BG-DONE-1",
      progress: `1/${total}`,
      sourceHash: SOURCE_HASH,
    });
    mockTranslateChunk.mockImplementation(async () => "BG-NEW");

    await translate({ translationId, bookId });

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("done");
    expect(row.text.startsWith("BG-DONE-1")).toBe(true);
    expect(mockTranslateChunk).toHaveBeenCalledTimes(total - 1);
  });

  it("starts over when saved progress no longer matches the chunking", async () => {
    const db = getDb();
    const { bookId, translationId } = await insertFixture(db, { text: "STALE", progress: "1/999", sourceHash: SOURCE_HASH });
    mockTranslateChunk.mockImplementation(async () => "BG");

    await translate({ translationId, bookId });

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("done");
    expect(row.text.includes("STALE")).toBe(false);
    expect(mockTranslateChunk).toHaveBeenCalledTimes(splitForTranslation(SOURCE).length);
  });

  it("starts over when the source text changed since the partial was made", async () => {
    const db = getDb();
    const total = splitForTranslation(SOURCE).length;
    const { bookId, translationId } = await insertFixture(db, {
      text: "OLD-SOURCE-PARTIAL",
      progress: `1/${total}`,
      sourceHash: "hash-of-the-old-text",
    });
    mockTranslateChunk.mockImplementation(async () => "BG");

    await translate({ translationId, bookId });

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("done");
    expect(row.text.includes("OLD-SOURCE-PARTIAL")).toBe(false);
    expect(row.sourceHash).toBe(SOURCE_HASH);
    expect(mockTranslateChunk).toHaveBeenCalledTimes(total);
  });

  it("does nothing when the translation was suspended before start", async () => {
    const db = getDb();
    const { bookId, translationId } = await insertFixture(db, { status: "suspended" });

    await translate({ translationId, bookId });

    expect(mockTranslateChunk).not.toHaveBeenCalled();
    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("suspended");
  });

  it("marks the row failed when the provider throws", async () => {
    const db = getDb();
    const { bookId, translationId } = await insertFixture(db);
    mockTranslateChunk.mockRejectedValue(new Error("API down"));

    await expect(translate({ translationId, bookId })).rejects.toThrow("API down");

    const [row] = await db.select().from(chapterTranslations).where(eq(chapterTranslations.id, translationId));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("API down");
  });
});
