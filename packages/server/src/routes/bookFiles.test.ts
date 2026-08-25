import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, resetDb } from "../../test/setup.ts";
import { bookFiles, books } from "../schema.ts";
import { eq } from "drizzle-orm";

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

vi.mock("graphile-worker", () => ({ quickAddJob: vi.fn(async () => {}) }));

import { bookFilesRouter } from "./bookFiles.ts";

const caller = bookFilesRouter.createCaller({});

async function twoFileBook() {
  const db = getDb();
  const [book] = await db
    .insert(books)
    .values({ title: "Two volumes", filename: "one.pdf", pdfPath: "/uploads/00_one.pdf" })
    .returning();
  const rows = await db
    .insert(bookFiles)
    .values([
      { bookId: book.id, index: 0, filename: "one.pdf", pdfPath: "/uploads/00_one.pdf", status: "done" },
      { bookId: book.id, index: 1, filename: "two.pdf", pdfPath: "/uploads/01_two.pdf", status: "done" },
    ])
    .returning();
  return { book, rows };
}

async function bookRow(id: string) {
  const [row] = await getDb().select().from(books).where(eq(books.id, id));
  return row;
}

beforeEach(async () => {
  await resetDb(getDb());
});

// books.pdfPath is the pre-book_files original, and the add-a-file route reads it as "the book's
// only PDF" whenever no rows remain. Left describing a deleted file, it puts that file back.
describe("removing a file keeps books.pdfPath describing a file that is still there", () => {
  it("follows on to the next file when the one it named is removed", async () => {
    const { book, rows } = await twoFileBook();

    await caller.remove({ id: rows[0].id });

    expect(await bookRow(book.id)).toMatchObject({ pdfPath: "/uploads/01_two.pdf", filename: "two.pdf" });
  });

  it("leaves nothing behind to restore once the last file is removed", async () => {
    const { book, rows } = await twoFileBook();

    await caller.remove({ id: rows[0].id });
    await caller.remove({ id: rows[1].id });

    expect(await bookRow(book.id)).toMatchObject({ pdfPath: null, filename: null });
    expect(await getDb().select().from(bookFiles).where(eq(bookFiles.bookId, book.id))).toEqual([]);
  });

  it("is untouched when a file other than the named one goes", async () => {
    const { book, rows } = await twoFileBook();

    await caller.remove({ id: rows[1].id });

    expect(await bookRow(book.id)).toMatchObject({ pdfPath: "/uploads/00_one.pdf", filename: "one.pdf" });
  });
});
