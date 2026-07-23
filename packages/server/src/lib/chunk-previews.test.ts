import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { chapterChunkPreviewDir, chapterChunkPreviewUrlBase, listChapterChunkPreviews, locateChunks, pageAtOffset } from "./chunk-previews.ts";
import type { SourceBlock } from "./marker.ts";

describe("chunk previews", () => {
  const bookId = `test-book-${crypto.randomUUID()}`;
  const chapterIndex = 3;

  afterEach(async () => {
    await rm(chapterChunkPreviewDir(bookId, chapterIndex), { recursive: true, force: true });
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
