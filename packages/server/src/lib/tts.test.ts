import { describe, expect, it } from "vitest";

import { getPreviewTextForVoice, parseTtsVoice, voiceSupportsSpeed } from "./tts.ts";

describe("parseTtsVoice", () => {
  it("treats legacy Kokoro voice ids as Kokoro", () => {
    expect(parseTtsVoice("af_heart")).toEqual({
      engine: "kokoro",
      voice: "af_heart",
      raw: "af_heart",
    });
  });

  it("parses prefixed Kokoro voice ids", () => {
    expect(parseTtsVoice("kokoro:bf_emma")).toEqual({
      engine: "kokoro",
      voice: "bf_emma",
      raw: "kokoro:bf_emma",
    });
  });

  it("parses the Bulgarian MLX narrator voice", () => {
    expect(parseTtsVoice("bg-mlx:narrator")).toEqual({
      engine: "bg-mlx",
      voice: "narrator",
      raw: "bg-mlx:narrator",
    });
  });

  it("rejects unsupported or empty prefixed voice ids", () => {
    expect(() => parseTtsVoice("bg-mlx:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("bg-mlx:other")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("kokoro:")).toThrow(/unsupported voice/i);
  });

  it("rejects malformed legacy Kokoro voice ids", () => {
    expect(() => parseTtsVoice("")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("../../voice")).toThrow(/unsupported voice/i);
  });
});

describe("getPreviewTextForVoice", () => {
  it("returns Bulgarian sample text for the MLX narrator", () => {
    expect(getPreviewTextForVoice("bg-mlx:narrator")).toMatch(/пролетна|утрин/i);
  });

  it("returns an English sample for Kokoro voices", () => {
    expect(getPreviewTextForVoice("kokoro:af_heart")).toMatch(/quick brown fox/i);
  });
});

describe("voiceSupportsSpeed", () => {
  it("disables speed control for the Bulgarian MLX narrator", () => {
    expect(voiceSupportsSpeed("bg-mlx:narrator")).toBe(false);
  });

  it("keeps speed control enabled for Kokoro", () => {
    expect(voiceSupportsSpeed("af_heart")).toBe(true);
  });
});
