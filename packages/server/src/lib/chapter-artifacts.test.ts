import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { removeChapterArtifacts } from "./chapter-artifacts.ts";
import { chapterChunkPreviewDir } from "./chunk-previews.ts";

describe("removeChapterArtifacts", () => {
  const bookId = `test-book-${crypto.randomUUID()}`;
  const index = 2;
  const audioPath = `/tmp/${crypto.randomUUID()}.mp3`;
  const chunkDir = chapterChunkPreviewDir(bookId, index);

  afterEach(async () => {
    await rm(audioPath, { force: true }).catch(() => {});
    await rm(chunkDir, { recursive: true, force: true }).catch(() => {});
  });

  it("removes both chapter audio and persisted chunk previews", async () => {
    await writeFile(audioPath, "audio");
    await mkdir(chunkDir, { recursive: true });
    await writeFile(`${chunkDir}/chunk-001.wav`, "chunk");

    await removeChapterArtifacts({ bookId, index, audioPath });

    await expect(rm(audioPath)).rejects.toThrow();
    await expect(rm(chunkDir)).rejects.toThrow();
  });
});
