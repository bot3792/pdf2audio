import { describe, expect, it, vi } from "vitest";

const { mockCartesiaSynthesize, MockCartesiaAbortedError } = vi.hoisted(() => ({
  mockCartesiaSynthesize: vi.fn(async () => {}),
  MockCartesiaAbortedError: class MockCartesiaAbortedError extends Error {},
}));

vi.mock("./cartesia.ts", () => ({
  cartesiaSynthesize: mockCartesiaSynthesize,
  CartesiaAbortedError: MockCartesiaAbortedError,
  findCartesiaVoice: vi.fn(async () => null),
}));

vi.mock("./kokoro.ts", () => ({
  synthesize: vi.fn(async () => {}),
  KokoroAbortedError: class KokoroAbortedError extends Error {},
}));

import { synthesize, TtsAbortedError } from "./tts.ts";

describe("tts Cartesia dispatcher", () => {
  it("routes cartesia voices to the Cartesia client", async () => {
    mockCartesiaSynthesize.mockClear();

    await synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/out.wav",
      voice: "cartesia:a0e99841-438c-4a64-b679-ae501e7d6091",
      speed: 1.2,
    });

    expect(mockCartesiaSynthesize).toHaveBeenCalledTimes(1);
    expect(mockCartesiaSynthesize).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: "a0e99841-438c-4a64-b679-ae501e7d6091",
      speed: 1.2,
      outputPath: "/tmp/out.wav",
    }));
  });

  it("maps CartesiaAbortedError to TtsAbortedError", async () => {
    mockCartesiaSynthesize.mockRejectedValueOnce(new MockCartesiaAbortedError());

    await expect(synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/out.wav",
      voice: "cartesia:a0e99841",
      speed: 1,
    })).rejects.toThrow(TtsAbortedError);
  });
});
