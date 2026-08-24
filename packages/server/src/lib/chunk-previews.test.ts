import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { blocksAtRange, chapterChunkPreviewDir, chapterChunkPreviewUrlBase, dropStaleChunks, listChapterChunkPreviews, locateChunks, pageAtOffset } from "./chunk-previews.ts";
import { bookOutputDir } from "./paths.ts";
import type { SourceBlock } from "./marker.ts";
import type { ChapterTextMap } from "../schema.ts";

describe("chunk previews", () => {
  const bookId = `test-book-${crypto.randomUUID()}`;
  const chapterIndex = 3;

  afterEach(async () => {
    await rm(bookOutputDir(bookId), { recursive: true, force: true });
  });

  it("builds a stable URL base for chapter chunk previews", () => {
    expect(chapterChunkPreviewUrlBase(bookId, chapterIndex)).toBe(`/files/${bookId}/chunks/ch003`);
  });

  it("lists persisted chunk previews in numeric order", async () => {
    const dir = chapterChunkPreviewDir(bookId, chapterIndex);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/chunk-010.wav`, "");
    await writeFile(`${dir}/chunk-002.wav`, "");
    await writeFile(`${dir}/notes.txt`, "ignore");

    await expect(listChapterChunkPreviews(bookId, chapterIndex)).resolves.toEqual([
      {
        index: 2,
        fileName: "chunk-002.wav",
        url: `/files/${bookId}/chunks/ch003/chunk-002.wav`,
      },
      {
        index: 10,
        fileName: "chunk-010.wav",
        url: `/files/${bookId}/chunks/ch003/chunk-010.wav`,
      },
    ]);
  });

  it("attaches chunk text from the chunks.json manifest", async () => {
    const dir = chapterChunkPreviewDir(bookId, chapterIndex);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/chunk-001.wav`, "");
    await writeFile(`${dir}/chunk-002.wav`, "");
    await writeFile(
      `${dir}/chunks.json`,
      JSON.stringify([
        { index: 1, text: "First chunk." },
        { index: 2, text: "Second chunk." },
      ]),
    );

    const previews = await listChapterChunkPreviews(bookId, chapterIndex);
    expect(previews.map((p) => p.text)).toEqual(["First chunk.", "Second chunk."]);
  });

  it("returns previews without text when no manifest exists", async () => {
    const dir = chapterChunkPreviewDir(bookId, chapterIndex);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/chunk-001.wav`, "");

    const previews = await listChapterChunkPreviews(bookId, chapterIndex);
    expect(previews).toEqual([
      { index: 1, fileName: "chunk-001.wav", url: `/files/${bookId}/chunks/ch003/chunk-001.wav` },
    ]);
  });
});

describe("locateChunks", () => {
  it("locates an exact substring range", () => {
    const source = "Hello world. Goodbye world.";
    expect(locateChunks(source, ["Hello world."])).toEqual([{ start: 0, end: 12 }]);
  });

  it("matches across collapsed whitespace (newlines and runs of spaces)", () => {
    const source = "Hello   world,\nhow are\nyou?";
    const [range] = locateChunks(source, ["Hello world, how are you?"]);
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe("Hello   world,\nhow are\nyou?");
  });

  it("resolves repeated chunk texts to sequential, non-overlapping ranges", () => {
    const source = "Run away. Run away.";
    const ranges = locateChunks(source, ["Run away.", "Run away."]);
    expect(ranges[0]).toEqual({ start: 0, end: 9 });
    expect(ranges[1]).toEqual({ start: 10, end: 19 });
  });

  it("matches despite spaces the chunker inserted at sentence joins", () => {
    const source = "Тя попитала: «Накъде сте се запътили?» «При Хер Корбес.» И тръгнали.";
    const ranges = locateChunks(source, [
      "Тя попитала: «Накъде сте се запътили? » «При Хер Корбес. »",
      "И тръгнали.",
    ]);
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe("Тя попитала: «Накъде сте се запътили?» «При Хер Корбес.»");
    expect(source.slice(ranges[1]!.start, ranges[1]!.end)).toBe("И тръгнали.");
  });

  it("returns null for a chunk absent from the source", () => {
    expect(locateChunks("Hello world.", ["Not present"])).toEqual([null]);
  });
});

describe("pageAtOffset", () => {
  function block(text: string, page: number, included = true): SourceBlock {
    return { type: "Text", text, page, included };
  }

  const blocks = [block("First page text.", 1), block("Second page text!", 2), block("Third.", 3)];
  // rawText replays the extraction-time join of included blocks
  const rawText = "First page text.\n\nSecond page text!\n\nThird.";

  it("maps offsets to the page of the containing block", () => {
    expect(pageAtOffset(blocks, rawText.length, 0)).toBe(1);
    expect(pageAtOffset(blocks, rawText.length, rawText.indexOf("Second"))).toBe(2);
    expect(pageAtOffset(blocks, rawText.length, rawText.indexOf("Third"))).toBe(3);
  });

  it("attributes the join gap between blocks to the earlier block's page", () => {
    expect(pageAtOffset(blocks, rawText.length, "First page text.\n".length)).toBe(1);
  });

  it("ignores excluded blocks, matching rawText construction", () => {
    const withExcluded = [block("Header", 1, false), ...blocks];
    expect(pageAtOffset(withExcluded, rawText.length, 0)).toBe(1);
    expect(pageAtOffset(withExcluded, rawText.length, rawText.indexOf("Third"))).toBe(3);
  });

  it("clamps offsets past the end to the last page", () => {
    expect(pageAtOffset(blocks, rawText.length, rawText.length + 100)).toBe(3);
  });

  it("scales proportionally when blocks no longer reconstruct rawText exactly", () => {
    expect(pageAtOffset(blocks, rawText.length * 2, rawText.length * 2 - 1)).toBe(3);
    expect(pageAtOffset(blocks, rawText.length * 2, 0)).toBe(1);
  });

  it("returns null when there are no included blocks", () => {
    expect(pageAtOffset([], 100, 0)).toBeNull();
    expect(pageAtOffset([block("Skipped", 1, false)], 100, 0)).toBeNull();
  });
});

describe("blocksAtRange", () => {
  const textMap: ChapterTextMap = {
    version: 1,
    spans: [
      { block: 0, start: 0, end: 10 },
      { block: 2, start: 12, end: 30 },
      { block: 3, start: 32, end: 40 },
    ],
  };

  it("returns the block a range sits inside", () => {
    expect(blocksAtRange(textMap, 14, 20)).toEqual([2]);
  });

  it("returns every block a range spans", () => {
    expect(blocksAtRange(textMap, 5, 35)).toEqual([0, 2, 3]);
  });

  it("ignores the join gap between blocks", () => {
    expect(blocksAtRange(textMap, 10, 12)).toEqual([]);
  });
});

describe("dropStaleChunks", () => {
  it("keeps cached chunks while the same text still lands at the same index", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chunks-"));
    await writeFile(path.join(dir, "chunks.json"), JSON.stringify([
      { index: 1, text: "One." },
      { index: 2, text: "Two." },
    ]));
    await writeFile(path.join(dir, "chunk-001.wav"), "a");
    await writeFile(path.join(dir, "chunk-002.wav"), "b");

    await dropStaleChunks(dir, ["One.", "Two.", "Three."]);
    expect((await readdir(dir)).sort()).toEqual(["chunk-001.wav", "chunk-002.wav", "chunks.json"]);
  });

  it("drops everything from the first chunk whose text changed, word timings included", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chunks-"));
    await writeFile(path.join(dir, "chunks.json"), JSON.stringify([
      { index: 1, text: "One. Two." },
      { index: 2, text: "Three." },
    ]));
    await writeFile(path.join(dir, "chunk-001.wav"), "a");
    await writeFile(path.join(dir, "chunk-001.words.json"), "[]");
    await writeFile(path.join(dir, "chunk-002.wav"), "b");

    // The chunker now cuts a sentence at a time, so nothing after chunk 1 is the same audio
    await dropStaleChunks(dir, ["One.", "Two.", "Three."]);
    expect((await readdir(dir)).sort()).toEqual(["chunks.json"]);
  });
});
