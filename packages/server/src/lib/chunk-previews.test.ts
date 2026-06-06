import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { chapterChunkPreviewDir, chapterChunkPreviewUrlBase, listChapterChunkPreviews, locateChunks } from "./chunk-previews.ts";

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
