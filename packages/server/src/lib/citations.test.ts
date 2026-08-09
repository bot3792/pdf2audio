import { describe, expect, it } from "vitest";
import { extractCitationIds, verifySources } from "./citations.ts";
import { CitationCatalog, type CitationSource } from "./chat-tools.ts";

function source(id: string, chunkId: string): CitationSource {
  return {
    id,
    chunkId,
    kind: "raw",
    bookId: "b1",
    bookTitle: "Book",
    fileId: "f1",
    page: 3,
    chapterId: null,
    chapterTitle: null,
    language: null,
  };
}

describe("extractCitationIds", () => {
  it("finds unique ids in order of first appearance", () => {
    expect(extractCitationIds("Claim [c_2] and [c_1], again [c_2].")).toEqual(["c_2", "c_1"]);
  });

  it("ignores malformed markers", () => {
    expect(extractCitationIds("[c_x] [c1] (c_2) [ c_3 ]")).toEqual([]);
  });
});

describe("verifySources", () => {
  it("keeps only ids known to the catalog", () => {
    const catalog = new CitationCatalog();
    catalog.seed([source("c_1", "chunk-1")]);
    const verified = verifySources("Real [c_1], hallucinated [c_9].", catalog);
    expect(verified.map((s) => s.id)).toEqual(["c_1"]);
  });
});

describe("CitationCatalog", () => {
  it("continues numbering after seeded ids from earlier turns", () => {
    const catalog = new CitationCatalog();
    catalog.seed([source("c_4", "chunk-4")]);
    const next = catalog.register({
      chunkId: "chunk-new",
      bookId: "b1",
      bookTitle: "Book",
      source: "raw",
      bookFileId: "f1",
      chapterId: null,
      chapterTitle: null,
      chapterIndex: null,
      chapterFileId: null,
      translationId: null,
      language: null,
      seq: 0,
      charStart: 0,
      charEnd: 10,
      pageStart: 1,
      pageEnd: 1,
      text: "text",
      score: 1,
    });
    expect(next.id).toBe("c_5");
  });

  it("returns the same id when the same chunk is registered twice", () => {
    const catalog = new CitationCatalog();
    const hit = {
      chunkId: "chunk-1",
      bookId: "b1",
      bookTitle: "Book",
      source: "raw" as const,
      bookFileId: "f1",
      chapterId: null,
      chapterTitle: null,
      chapterIndex: null,
      chapterFileId: null,
      translationId: null,
      language: null,
      seq: 0,
      charStart: 0,
      charEnd: 10,
      pageStart: 1,
      pageEnd: 1,
      text: "text",
      score: 1,
    };
    expect(catalog.register(hit).id).toBe(catalog.register(hit).id);
  });
});
