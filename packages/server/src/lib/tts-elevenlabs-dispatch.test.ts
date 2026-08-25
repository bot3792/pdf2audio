import { describe, expect, it, vi } from "vitest";

const { mockElevenlabsSynthesize, MockElevenLabsAbortedError } = vi.hoisted(() => ({
  mockElevenlabsSynthesize: vi.fn(async () => {}),
  MockElevenLabsAbortedError: class MockElevenLabsAbortedError extends Error {},
}));

vi.mock("./elevenlabs.ts", () => ({
  elevenlabsSynthesize: mockElevenlabsSynthesize,
  ElevenLabsAbortedError: MockElevenLabsAbortedError,
  findElevenLabsVoice: vi.fn(async () => null),
}));

vi.mock("./kokoro.ts", () => ({
  synthesize: vi.fn(async () => {}),
  KokoroAbortedError: class KokoroAbortedError extends Error {},
}));

import { parseTtsVoice, synthesize, TtsAbortedError, voiceSupportsSpeed } from "./tts.ts";

describe("tts ElevenLabs dispatcher", () => {
  it("routes elevenlabs voices to the ElevenLabs client", async () => {
    mockElevenlabsSynthesize.mockClear();

    await synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/out.wav",
      voice: "elevenlabs:XB0fDUnXU5powFXDhCwa",
      speed: 1.1,
    });

    expect(mockElevenlabsSynthesize).toHaveBeenCalledTimes(1);
    expect(mockElevenlabsSynthesize).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: "XB0fDUnXU5powFXDhCwa",
      speed: 1.1,
      outputPath: "/tmp/out.wav",
    }));
  });

  it("maps ElevenLabsAbortedError to TtsAbortedError", async () => {
    mockElevenlabsSynthesize.mockRejectedValueOnce(new MockElevenLabsAbortedError());

    await expect(synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/out.wav",
      voice: "elevenlabs:XB0fDUnXU5powFXDhCwa",
      speed: 1,
    })).rejects.toThrow(TtsAbortedError);
  });

  it("rejects an id that is not an ElevenLabs voice handle", () => {
    expect(() => parseTtsVoice("elevenlabs:short")).toThrow(/Unsupported voice ID/);
  });

  // The picker offers the slider off ENGINE_PREFIXES; the backend has to honour it or the control lies
  it("reports speed support", () => {
    expect(voiceSupportsSpeed("elevenlabs:XB0fDUnXU5powFXDhCwa")).toBe(true);
  });
});
