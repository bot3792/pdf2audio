import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./kokoro.ts", () => ({
  synthesize: vi.fn(async () => {}),
  KokoroAbortedError: class KokoroAbortedError extends Error {},
}));

import { synthesize as kokoroSynthesize } from "./kokoro.ts";
import { synthesize } from "./tts.ts";

const mockKokoroSynthesize = vi.mocked(kokoroSynthesize);

describe("tts dispatcher", () => {
  beforeEach(() => {
    mockKokoroSynthesize.mockClear();
  });

  it("routes legacy Kokoro voices to Kokoro with the stripped voice id", async () => {
    await synthesize({
      inputText: "hello world",
      outputPath: "/tmp/out.wav",
      voice: "af_heart",
      speed: 1.2,
    });

    expect(mockKokoroSynthesize).toHaveBeenCalledWith(expect.objectContaining({
      voice: "af_heart",
      speed: 1.2,
    }));
  });

  it("routes prefixed Kokoro voices to Kokoro with the stripped voice id", async () => {
    await synthesize({
      inputText: "hello world",
      outputPath: "/tmp/out.wav",
      voice: "kokoro:bf_emma",
      speed: 0.9,
    });

    expect(mockKokoroSynthesize).toHaveBeenCalledWith(expect.objectContaining({
      voice: "bf_emma",
      speed: 0.9,
    }));
  });
});
