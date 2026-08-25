import { describe, expect, it } from "vitest";

import { chapterMode } from "./reader-doc.ts";
import type { Chapter } from "../schema.ts";

// An extracted chapter that has been through synthesis: blocks from marker, a map from normalize
function extracted(overrides: Partial<Chapter> = {}): Chapter {
  return {
    sourceBlocks: [{ type: "Text", text: "A line of print.", page: 1, included: true, polygon: [] }],
    customText: null,
    textMap: { version: 1, spans: [{ block: 0, start: 0, end: 16 }] },
    audioPath: "/data/output/chapter.m4a",
    ...overrides,
  } as unknown as Chapter;
}

describe("chapterMode", () => {
  it("marks a narrated chapter on its pages", () => {
    expect(chapterMode(extracted())).toEqual({ mode: "page" });
  });

  // The state every extracted chapter is in before synthesis: normalize writes textMap, not marker
  it("says a chapter is simply unnarrated when nothing has spoken it yet", () => {
    expect(chapterMode(extracted({ textMap: null, audioPath: null })))
      .toEqual({ mode: "text", why: "unnarrated" });
  });

  it("distinguishes audio that predates the text map, which narrating again would write", () => {
    expect(chapterMode(extracted({ textMap: null })))
      .toEqual({ mode: "text", why: "unmapped" });
  });

  it("says the text was edited when a chapter carries an override", () => {
    expect(chapterMode(extracted({ customText: "Rewritten." }))).toEqual({ mode: "text", why: "edited" });
  });

  it("says the text was written when a chapter never came off a page", () => {
    expect(chapterMode(extracted({ sourceBlocks: null }))).toEqual({ mode: "text", why: "generated" });
  });
});
