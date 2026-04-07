import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, resetDb } from "../../test/setup.ts";
import { books } from "../schema.ts";

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
});
