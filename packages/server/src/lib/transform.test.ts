import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "./transform.ts";

describe("splitIntoChunks", () => {
  it("keeps a short text as a single chunk", () => {
    expect(splitIntoChunks("Hello there.\n\nSecond paragraph.")).toEqual([
      "Hello there.\n\nSecond paragraph.",
    ]);
  });

  it("groups paragraphs up to the size limit without splitting them", () => {
    const para = "Word ".repeat(200).trim();
    const chunks = splitIntoChunks([para, para, para, para].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2500);
    }
    expect(chunks.join("\n\n")).toContain(para);
  });

  it("splits an oversized paragraph at sentence boundaries", () => {
    const long = "This is a sentence. ".repeat(300).trim();
    const chunks = splitIntoChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith(".")).toBe(true);
    }
  });

  it("is deterministic", () => {
    const text = "Para one. ".repeat(100) + "\n\n" + "Para two. ".repeat(400);
    expect(splitIntoChunks(text)).toEqual(splitIntoChunks(text));
  });

  it("drops empty paragraphs and whitespace-only text", () => {
    expect(splitIntoChunks("  \n\n  \n\n")).toEqual([]);
    expect(splitIntoChunks("A.\n\n   \n\nB.")).toEqual(["A.\n\nB."]);
  });
});
