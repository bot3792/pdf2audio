import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, resetDb } from "../../test/setup.ts";
import { books, chapters } from "../schema.ts";

vi.mock("../lib/tts.ts", () => {
  class TtsAbortedError extends Error {
    constructor() {
      super("TTS synthesis aborted");
      this.name = "TtsAbortedError";
    }
  }

  return {
    synthesize: vi.fn(),
    TtsAbortedError,
    voiceSupportsSpeed: (voice: string) => voice.startsWith("kokoro:"),
  };
});

vi.mock("../lib/ffmpeg.ts", () => ({
  wavToMp3: vi.fn(async () => {}),
}));

vi.mock("../lib/paths.ts", () => ({
  bookOutputDir: (bookId: string) => `/tmp/test-output-${bookId}`,
}));

vi.mock("../lib/log.ts", () => ({
  appendLog: vi.fn(async () => {}),
}));

vi.mock("music-metadata", () => ({
  parseFile: vi.fn(async () => ({ format: { duration: 12.4 } })),
}));

vi.mock("../db.ts", async () => {
  const { getDb } = await import("../../test/setup.ts");
  return { get db() { return getDb(); } };
});

import { synthesize as synthesizeAudio, TtsAbortedError } from "../lib/tts.ts";
import { synthesize as synthesizeWorker } from "./synthesize.ts";

const mockSynthesizeAudio = vi.mocked(synthesizeAudio);

describe("synthesize worker", () => {
  beforeEach(async () => {
    await resetDb(getDb());
    mockSynthesizeAudio.mockReset();
  });

  it("passes the stored voice to the generic dispatcher and marks the chapter done", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();

    await db.insert(books).values({
      id: bookId,
      title: "Bulgarian Book",
      filename: "book.pdf",
      pdfPath: "/tmp/book.pdf",
      voice: "bg-mlx:narrator",
      speed: 1.0,
    });

    await db.insert(chapters).values({
      id: chapterId,
      bookId,
      index: 0,
      title: "Chapter 1",
      rawText: "Сутринта беше тиха и светла.",
      cleanText: "Сутринта беше тиха и светла.",
    });

    mockSynthesizeAudio.mockImplementation(async ({ onProgress }) => {
      await onProgress?.(1, 2);
      await onProgress?.(2, 2);
    });

    await synthesizeWorker({ bookId, chapterId }, { addJob: vi.fn() } as never);

    expect(mockSynthesizeAudio).toHaveBeenCalledWith(expect.objectContaining({
      voice: "bg-mlx:narrator",
      speed: 1.0,
    }));

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    expect(chapter.status).toBe("done");
    expect(chapter.progress).toBeNull();
    expect(chapter.audioPath).toContain("ch000.mp3");
    expect(chapter.durationMs).toBe(12400);
    expect(chapter.synthesizedWith).toEqual({ voice: "bg-mlx:narrator", speed: null });
  });

  it("suspends the chapter when the generic dispatcher aborts", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();

    await db.insert(books).values({
      id: bookId,
      title: "Bulgarian Book",
      filename: "book.pdf",
      pdfPath: "/tmp/book.pdf",
      voice: "bg-mlx:narrator",
      speed: 1.0,
    });

    await db.insert(chapters).values({
      id: chapterId,
      bookId,
      index: 0,
      title: "Chapter 1",
      rawText: "Сутринта беше тиха и светла.",
    });

    mockSynthesizeAudio.mockRejectedValue(new TtsAbortedError());

    await synthesizeWorker({ bookId, chapterId }, { addJob: vi.fn() } as never);

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    expect(chapter.status).toBe("suspended");
    expect(chapter.error).toBeNull();
  });

  it("passes the Meta MMS Bulgarian voice through to the dispatcher", async () => {
    const db = getDb();
    const bookId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();

    await db.insert(books).values({
      id: bookId,
      title: "Bulgarian Book",
      filename: "book.pdf",
      pdfPath: "/tmp/book.pdf",
      voice: "bg-mms:bul",
      speed: 1.0,
    });

    await db.insert(chapters).values({
      id: chapterId,
      bookId,
      index: 0,
      title: "Chapter 1",
      rawText: "Добро утро.",
      cleanText: "Добро утро.",
    });

    mockSynthesizeAudio.mockImplementation(async () => {});

    await synthesizeWorker({ bookId, chapterId }, { addJob: vi.fn() } as never);

    expect(mockSynthesizeAudio).toHaveBeenCalledWith(expect.objectContaining({
      voice: "bg-mms:bul",
      speed: 1.0,
    }));

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    expect(chapter.synthesizedWith).toEqual({ voice: "bg-mms:bul", speed: null });
  });
});
