import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, resetDb } from "../../test/setup.ts";
import { books, folders } from "../schema.ts";
import { eq } from "drizzle-orm";

const { mockDeleteBook } = vi.hoisted(() => ({
  mockDeleteBook: vi.fn(async (_id: string) => {}),
}));

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

vi.mock("../lib/delete-book.ts", () => ({
  deleteBook: mockDeleteBook,
}));

import { foldersRouter } from "./folders.ts";

const caller = foldersRouter.createCaller({});

async function makeTree() {
  const db = getDb();
  const [a] = await db.insert(folders).values({ name: "A" }).returning();
  const [b] = await db.insert(folders).values({ name: "B", parentId: a.id }).returning();
  const [c] = await db.insert(folders).values({ name: "C", parentId: b.id }).returning();
  return { a, b, c };
}

beforeEach(async () => {
  await resetDb(getDb());
  mockDeleteBook.mockClear();
  mockDeleteBook.mockImplementation(async (id: string) => {
    await getDb().delete(books).where(eq(books.id, id));
  });
});

describe("foldersRouter CRUD", () => {
  it("creates, lists and renames folders", async () => {
    const root = await caller.create({ name: "History", parentId: null });
    const child = await caller.create({ name: "Ancient", parentId: root.id });
    expect(child.parentId).toBe(root.id);

    await caller.rename({ id: child.id, name: "Medieval" });

    const list = await caller.list();
    expect(list).toEqual([
      { id: root.id, name: "History", parentId: null },
      { id: child.id, name: "Medieval", parentId: root.id },
    ]);
  });

  it("rejects creating under a missing parent", async () => {
    await expect(caller.create({ name: "X", parentId: crypto.randomUUID() })).rejects.toThrow(
      "Parent folder not found",
    );
  });

  it("returns the ancestor path root-first", async () => {
    const { a, c } = await makeTree();
    const path = await caller.path({ id: c.id });
    expect(path.map((p) => p.name)).toEqual(["A", "B", "C"]);
    expect(path[0].id).toBe(a.id);
  });
});

describe("foldersRouter.deleteStats", () => {
  it("counts the subtree recursively", async () => {
    const db = getDb();
    const { a, b, c } = await makeTree();
    await db.insert(books).values([
      { title: "In A", folderId: a.id },
      { title: "In B", folderId: b.id },
      { title: "In C", folderId: c.id },
      { title: "Root book" },
    ]);

    expect(await caller.deleteStats({ id: a.id })).toEqual({ folderCount: 3, bookCount: 3 });
    expect(await caller.deleteStats({ id: b.id })).toEqual({ folderCount: 2, bookCount: 2 });
  });
});

describe("foldersRouter.delete", () => {
  it("deletes every descendant book through deleteBook and sweeps the folder tree", async () => {
    const db = getDb();
    const { a, c } = await makeTree();
    const [other] = await db.insert(folders).values({ name: "Other" }).returning();
    const inA = crypto.randomUUID();
    const inC = crypto.randomUUID();
    const rootBook = crypto.randomUUID();
    const inOther = crypto.randomUUID();
    await db.insert(books).values([
      { id: inA, title: "In A", folderId: a.id },
      { id: inC, title: "In C", folderId: c.id },
      { id: rootBook, title: "Root book" },
      { id: inOther, title: "In other", folderId: other.id },
    ]);

    const result = await caller.delete({ id: a.id });

    expect(result).toEqual({ deletedBooks: 2, deletedFolders: 3 });
    expect(mockDeleteBook.mock.calls.map((call) => call[0]).sort()).toEqual([inA, inC].sort());
    const remainingFolders = await db.select().from(folders);
    expect(remainingFolders.map((f) => f.id)).toEqual([other.id]);
    const remainingBooks = await db.select().from(books);
    expect(remainingBooks.map((bk) => bk.id).sort()).toEqual([rootBook, inOther].sort());
  });

  it("rejects deleting a missing folder", async () => {
    await expect(caller.delete({ id: crypto.randomUUID() })).rejects.toThrow("Folder not found");
    expect(mockDeleteBook).not.toHaveBeenCalled();
  });
});
