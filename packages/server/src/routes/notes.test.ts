import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../test/setup.ts";
import { books, notes } from "../schema.ts";
import { eq } from "drizzle-orm";

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { notesRouter } from "./notes.ts";

async function insertBook() {
  const db = getDb();
  const bookId = crypto.randomUUID();
  await db.insert(books).values({ id: bookId, title: "Book", filename: "b.pdf", pdfPath: "/tmp/b.pdf" });
  return bookId;
}

describe("notesRouter", () => {
  beforeEach(async () => {
    await resetDb(getDb());
  });

  it("lists notes for a book newest-first", async () => {
    const db = getDb();
    const bookId = await insertBook();
    const otherBookId = await insertBook();
    await db.insert(notes).values([
      { bookId, prompt: "old", model: "flash", result: "r1", scope: { kind: "book-raw", files: 1 }, createdAt: new Date("2026-07-01") },
      { bookId, prompt: "new", model: "pro", result: "r2", scope: { kind: "chapters", chapters: [{ id: crypto.randomUUID(), title: "Ch 1" }] }, createdAt: new Date("2026-07-02") },
      { bookId: otherBookId, prompt: "other", model: "flash", result: "r3", scope: { kind: "book-raw", files: 1 } },
    ]);

    const caller = notesRouter.createCaller({});
    const list = await caller.list({ bookId });

    expect(list.map((n) => n.prompt)).toEqual(["new", "old"]);
  });

  it("deletes a note", async () => {
    const db = getDb();
    const bookId = await insertBook();
    const [note] = await db
      .insert(notes)
      .values({ bookId, prompt: "p", model: "flash", result: "r", scope: { kind: "book-raw", files: 1 } })
      .returning();

    const caller = notesRouter.createCaller({});
    await caller.delete({ id: note.id });

    expect(await db.select().from(notes).where(eq(notes.id, note.id))).toHaveLength(0);
  });

  it("cascades when the book is deleted", async () => {
    const db = getDb();
    const bookId = await insertBook();
    await db.insert(notes).values({ bookId, prompt: "p", model: "flash", result: "r", scope: { kind: "book-raw", files: 1 } });

    await db.delete(books).where(eq(books.id, bookId));

    expect(await db.select().from(notes)).toHaveLength(0);
  });
});
