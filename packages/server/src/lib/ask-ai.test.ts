import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../test/setup.ts";
import { books, bookFiles, chapters } from "../schema.ts";

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

const { buildAskContext } = await import("./ask-ai.ts");

describe("buildAskContext", () => {
  beforeEach(async () => {
    await resetDb(getDb());
  });

  it("book-raw: concatenates file texts in index order and reports file count in the note scope", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    await db.insert(books).values({ id: bookId, title: "Raw", filename: "raw.pdf", pdfPath: "/tmp/raw.pdf" });
    await db.insert(bookFiles).values([
      { bookId, index: 1, filename: "vol2.pdf", pdfPath: "/tmp/b.pdf", status: "raw", rawText: "Second volume text." },
      { bookId, index: 0, filename: "vol1.pdf", pdfPath: "/tmp/a.pdf", status: "raw", rawText: "First volume text." },
    ]);

    const ctx = await buildAskContext({ kind: "book-raw", bookId });
    expect(ctx.bookId).toBe(bookId);
    expect(ctx.corpus.indexOf("First volume text.")).toBeGreaterThan(-1);
    expect(ctx.corpus.indexOf("First volume text.")).toBeLessThan(ctx.corpus.indexOf("Second volume text."));
    expect(ctx.noteScope).toEqual({ kind: "book-raw", files: 2 });
    expect(ctx.system).toMatch(/raw text of a book/);
  });

  it("book-raw: rejects when the book has no raw text", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    await db.insert(books).values({ id: bookId, title: "Empty", filename: "e.pdf", pdfPath: "/tmp/e.pdf" });
    await db.insert(bookFiles).values({ bookId, index: 0, filename: "e.pdf", pdfPath: "/tmp/e.pdf", status: "raw" });

    await expect(buildAskContext({ kind: "book-raw", bookId })).rejects.toThrow(/no raw text/i);
  });

  it("chapters: uses the customText ?? cleanText ?? rawText precedence and snapshots titles", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    await db.insert(books).values({ id: bookId, title: "B", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
    const chapterId = crypto.randomUUID();
    await db.insert(chapters).values({
      id: chapterId,
      bookId,
      index: 0,
      title: "Ch",
      rawText: "raw text",
      cleanText: "clean text",
      customText: "custom text",
    });

    const ctx = await buildAskContext({ kind: "chapters", chapterIds: [chapterId] });
    expect(ctx.bookId).toBe(bookId);
    expect(ctx.corpus).toContain("custom text");
    expect(ctx.corpus).not.toContain("clean text");
    expect(ctx.corpus).toContain('Chapter 1: "Ch"');
    expect(ctx.noteScope).toEqual({ kind: "chapters", chapters: [{ id: chapterId, title: "Ch" }] });
    expect(ctx.system).toMatch(/one book chapter/);
  });

  it("chapters: rejects unknown chapter ids", async () => {
    await expect(buildAskContext({ kind: "chapters", chapterIds: [crypto.randomUUID()] })).rejects.toThrow(
      "Chapters not found",
    );
  });
});
