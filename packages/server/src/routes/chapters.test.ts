import { beforeEach, describe, expect, it, vi } from "vitest";

const { chapters, quickAddJob, appendLog } = vi.hoisted(() => ({
  chapters: { id: "id", bookId: "bookId" },
  quickAddJob: vi.fn(async () => {}),
  appendLog: vi.fn(async () => {}),
}));

type MockChapter = {
  id: string;
  bookId: string;
  index: number;
  status: string;
  cleanText: string | null;
};

let currentChapter: MockChapter;
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock("../schema.ts", () => ({ chapters }));
vi.mock("graphile-worker", () => ({ quickAddJob }));
vi.mock("../lib/log.ts", () => ({ appendLog }));
vi.mock("../env.ts", () => ({ env: { DATABASE_URL: "postgres://test" } }));
vi.mock("../db.ts", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [currentChapter]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updateCalls.push(values);
          return [];
        }),
      })),
    })),
  },
}));

import { chaptersRouter } from "./chapters.ts";

describe("chaptersRouter.queue", () => {
  beforeEach(() => {
    currentChapter = {
      id: "11111111-1111-1111-1111-111111111111",
      bookId: "22222222-2222-2222-2222-222222222222",
      index: 0,
      status: "suspended",
      cleanText: null,
    };
    updateCalls.length = 0;
    quickAddJob.mockClear();
    appendLog.mockClear();
  });

  it("queues normalization for a suspended chapter without clean text", async () => {
    const caller = chaptersRouter.createCaller({});

    const result = await caller.queue({ id: currentChapter.id });

    expect(result).toEqual({ success: true });
    expect(updateCalls).toEqual([{ status: "pending", error: null, audioPath: null, durationMs: null }]);
    expect(quickAddJob).toHaveBeenCalledWith(
      { connectionString: "postgres://test" },
      "normalize",
      { chapterId: currentChapter.id, bookId: currentChapter.bookId },
      { maxAttempts: 1 }
    );
  });

  it("queues synthesis for a suspended chapter with clean text", async () => {
    currentChapter.cleanText = "already normalized";
    const caller = chaptersRouter.createCaller({});

    await caller.queue({ id: currentChapter.id });

    expect(quickAddJob).toHaveBeenCalledWith(
      { connectionString: "postgres://test" },
      "synthesize",
      { chapterId: currentChapter.id, bookId: currentChapter.bookId },
      { maxAttempts: 1 }
    );
  });
});
