import { describe, expect, it } from "vitest";
import { normalizeForTts } from "./normalizer.ts";

describe("normalizeForTts", () => {
  it("strips markdown bold and italic", () => {
    expect(normalizeForTts("This is **bold** and *italic* text")).toBe(
      "This is bold and italic text",
    );
  });

  it("strips markdown links, keeping the text", () => {
    expect(normalizeForTts("Visit [Google](https://google.com) now")).toBe(
      "Visit Google now",
    );
  });

  it("removes markdown images entirely", () => {
    expect(normalizeForTts("Before ![alt](img.png) after")).toBe(
      "Before after",
    );
  });

  it("removes reference markers like [1] and [iv]", () => {
    expect(normalizeForTts("Some claim [1] and another [iv] here")).toBe(
      "Some claim and another here",
    );
  });

  it("removes bare URLs", () => {
    expect(normalizeForTts("See https://example.com/foo for details")).toBe(
      "See for details",
    );
  });

  it("rejoins hyphenated line breaks", () => {
    expect(normalizeForTts("con-\ntinue")).toBe("continue");
  });

  it("collapses multiple blank lines", () => {
    expect(normalizeForTts("A\n\n\n\n\nB")).toBe("A\n\nB");
  });

  it("handles a realistic paragraph with mixed markdown", () => {
    const input = `## Chapter One

This is a **bold** claim [1]. See [details](https://example.com) for more info.

![figure](fig1.png)

The con-
clusion is *important*.`;

    const result = normalizeForTts(input);
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("[1]");
    expect(result).not.toContain("https://");
    expect(result).not.toContain("![");
    expect(result).toContain("conclusion");
    expect(result).toContain("bold claim");
  });
});
