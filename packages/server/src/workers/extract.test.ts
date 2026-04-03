import { beforeEach, describe, expect, it, vi } from "vitest";

const { books, chapters, appendLog, extractPdf, insertCalls, updateCalls } = vi.hoisted(() => ({
  books: { name: "books" },
  chapters: { name: "chapters" },
  appendLog: vi.fn(async () => {}),
  extractPdf: vi.fn(),
  insertCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

type MockBook = {
  id: string;
  pdfPath: string;
  forceOcr: boolean;
  llmChapterDetection: boolean;
  skipSynthesis: boolean;
};

type MockChapter = {
  title: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  sourceBlocks: Array<{ type: string; text: string; page: number; included: boolean }>;
};

let currentBook: MockBook;
let extractedChapters: MockChapter[];

vi.mock("../schema.ts", () => ({ books, chapters }));

vi.mock("../lib/log.ts", () => ({ appendLog }));

vi.mock("../lib/paths.ts", () => ({
  bookTmpDir: (bookId: string) => `/tmp/${bookId}`,
}));

vi.mock("../lib/marker.ts", () => ({ extractPdf }));

vi.mock("../db.ts", () => ({
  db: {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updateCalls.push({ table, values });
          return [];
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [currentBook]),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          insertCalls.push({ table, values });
          return [{ id: `chapter-${insertCalls.length}` }];
        }),
      })),
    })),
  },
}));

import { extract } from "./extract.ts";

describe("extract worker", () => {
  beforeEach(() => {
    currentBook = {
      id: "book-1",
      pdfPath: "/tmp/book.pdf",
      forceOcr: false,
      llmChapterDetection: false,
      skipSynthesis: false,
    };
    extractedChapters = [
      {
        title: "Chapter 1",
        text: "One two three",
        pageStart: 1,
        pageEnd: 2,
        sourceBlocks: [{ type: "Text", text: "One two three", page: 1, included: true }],
      },
      {
        title: "Chapter 2",
        text: "Four five six",
        pageStart: 3,
        pageEnd: 4,
        sourceBlocks: [{ type: "Text", text: "Four five six", page: 3, included: true }],
      },
    ];
    insertCalls.length = 0;
    updateCalls.length = 0;
    appendLog.mockClear();
    extractPdf.mockReset();
    extractPdf.mockImplementation(async () => extractedChapters);
  });

  it("creates suspended chapters and skips normalize jobs in reader mode", async () => {
    currentBook.skipSynthesis = true;
    const addJob = vi.fn();

    await extract({ bookId: currentBook.id }, { addJob });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls.map((call) => call.values.status)).toEqual(["suspended", "suspended"]);
    expect(addJob).not.toHaveBeenCalled();
  });

  it("keeps queuing normalization jobs when synthesis is enabled", async () => {
    const addJob = vi.fn();

    await extract({ bookId: currentBook.id }, { addJob });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls.map((call) => call.values.status)).toEqual(["pending", "pending"]);
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(1, "normalize", { chapterId: "chapter-1", bookId: currentBook.id }, { maxAttempts: 1 });
    expect(addJob).toHaveBeenNthCalledWith(2, "normalize", { chapterId: "chapter-2", bookId: currentBook.id }, { maxAttempts: 1 });
  });
});
