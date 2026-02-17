import NodeID3 from "node-id3";

type ChapterMeta = {
  title: string;
  startMs: number;
  endMs: number;
};

type AudiobookMeta = {
  title: string;
  artist: string;
  chapters: ChapterMeta[];
};

export function writeChapterMarkers(mp3Path: string, meta: AudiobookMeta): void {
  const chapterTags = meta.chapters.map((ch, i) => ({
    elementID: `chap${String(i + 1).padStart(3, "0")}`,
    startTimeMs: ch.startMs,
    endTimeMs: ch.endMs,
    tags: { title: ch.title },
  }));

  const tags: NodeID3.Tags = {
    title: meta.title,
    artist: meta.artist,
    chapter: chapterTags,
    tableOfContents: [
      {
        elementID: "toc",
        isOrdered: true,
        elements: chapterTags.map((c) => c.elementID),
        tags: { title: "Table of Contents" },
      },
    ],
  };

  const result = NodeID3.update(tags, mp3Path);
  if (result instanceof Error) {
    throw result;
  }
}
