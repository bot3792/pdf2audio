import { describe, expect, it, vi } from "vitest";

vi.mock("./cartesia.ts", () => ({
  cartesiaSynthesize: vi.fn(),
  CartesiaAbortedError: class CartesiaAbortedError extends Error {},
  findCartesiaVoice: vi.fn(async (id: string) =>
    id === "bg-voice-uuid" ? { id, name: "Ana", language: "bg", gender: "feminine", tagline: "" } : null,
  ),
}));

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

  it("parses the Meta MMS Bulgarian voice", () => {
    expect(parseTtsVoice("bg-mms:bul")).toEqual({
      engine: "bg-mms",
      voice: "bul",
      raw: "bg-mms:bul",
    });
  });

  it("parses the KugelAudio voice", () => {
    expect(parseTtsVoice("kugel:default")).toEqual({
      engine: "kugel",
      voice: "default",
      raw: "kugel:default",
    });
  });

  it("parses Cartesia voice ids", () => {
    expect(parseTtsVoice("cartesia:a0e99841-438c-4a64-b679-ae501e7d6091")).toEqual({
      engine: "cartesia",
      voice: "a0e99841-438c-4a64-b679-ae501e7d6091",
      raw: "cartesia:a0e99841-438c-4a64-b679-ae501e7d6091",
    });
    expect(() => parseTtsVoice("cartesia:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("cartesia:bad id")).toThrow(/unsupported voice/i);
  });

  it("parses macOS say voice slugs", () => {
    expect(parseTtsVoice("say:daria-enhanced")).toEqual({
      engine: "say",
      voice: "daria-enhanced",
      raw: "say:daria-enhanced",
    });
    expect(parseTtsVoice("say:eddy-english-united-states")).toEqual({
      engine: "say",
      voice: "eddy-english-united-states",
      raw: "say:eddy-english-united-states",
    });
  });

  it("rejects unsupported or empty prefixed voice ids", () => {
    expect(() => parseTtsVoice("bg-mlx:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("bg-mlx:other")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("bg-mms:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("bg-mms:other")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("kugel:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("kugel:other")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("say:")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("say:Daria (Enhanced)")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("kokoro:")).toThrow(/unsupported voice/i);
  });

  it("rejects malformed legacy Kokoro voice ids", () => {
    expect(() => parseTtsVoice("")).toThrow(/unsupported voice/i);
    expect(() => parseTtsVoice("../../voice")).toThrow(/unsupported voice/i);
  });
});

describe("getPreviewTextForVoice", () => {
  it("returns Bulgarian sample text for the MLX narrator", async () => {
    expect(await getPreviewTextForVoice("bg-mlx:narrator")).toMatch(/пролетна|утрин/i);
  });

  it("returns Bulgarian sample text for the MMS voice", async () => {
    expect(await getPreviewTextForVoice("bg-mms:bul")).toMatch(/пролетна|утрин/i);
  });

  it("returns an English sample for Kokoro voices", async () => {
    expect(await getPreviewTextForVoice("kokoro:af_heart")).toMatch(/quick brown fox/i);
  });

  it("returns Bulgarian sample text for the KugelAudio voice", async () => {
    expect(await getPreviewTextForVoice("kugel:default")).toMatch(/пролетна|утрин/i);
  });

  it("falls back to English for a say voice that is not installed", async () => {
    expect(await getPreviewTextForVoice("say:no-such-voice-installed")).toMatch(/quick brown fox/i);
  });

  it("matches Cartesia preview text to the voice language", async () => {
    expect(await getPreviewTextForVoice("cartesia:bg-voice-uuid")).toMatch(/пролетна|утрин/i);
    expect(await getPreviewTextForVoice("cartesia:unknown-voice")).toMatch(/quick brown fox/i);
  });
});

describe("voiceSupportsSpeed", () => {
  it("disables speed control for the Bulgarian MLX narrator", () => {
    expect(voiceSupportsSpeed("bg-mlx:narrator")).toBe(false);
  });

  it("disables speed control for the Meta MMS Bulgarian voice", () => {
    expect(voiceSupportsSpeed("bg-mms:bul")).toBe(false);
  });

  it("disables speed control for the KugelAudio voice", () => {
    expect(voiceSupportsSpeed("kugel:default")).toBe(false);
  });

  it("keeps speed control enabled for Kokoro", () => {
    expect(voiceSupportsSpeed("af_heart")).toBe(true);
  });

  it("enables speed control for the macOS say voice", () => {
    expect(voiceSupportsSpeed("say:daria-enhanced")).toBe(true);
  });

  it("enables speed control for Cartesia voices", () => {
    expect(voiceSupportsSpeed("cartesia:a0e99841")).toBe(true);
  });
});
