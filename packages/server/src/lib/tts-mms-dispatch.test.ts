import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWriteFile, mockSpawn } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(async () => {}),
  mockSpawn: vi.fn(() => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };

    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = vi.fn();

    queueMicrotask(() => {
      proc.emit("close", 0);
    });

    return proc;
  }),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:readline", () => ({
  createInterface: ({ input }: { input: EventEmitter }) => ({
    on(event: string, callback: (line: string) => void) {
      input.on(event, callback);
      return this;
    },
    close() {},
  }),
}));

vi.mock("./kokoro.ts", () => ({
  synthesize: vi.fn(async () => {}),
  KokoroAbortedError: class KokoroAbortedError extends Error {},
}));

import { synthesize } from "./tts.ts";

describe("tts MMS dispatcher", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockWriteFile.mockClear();
  });

  it("routes the Meta MMS Bulgarian voice to the MMS script", async () => {
    await synthesize({
      inputText: "Здравей, свят.",
      outputPath: "/tmp/out.wav",
      voice: "bg-mms:bul",
      speed: 1,
    });

    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringMatching(/python$/),
      expect.arrayContaining([
        expect.stringMatching(/synthesize_mms_tts\.py$/),
        "--voice",
        "bul",
      ]),
      expect.any(Object)
    );
  });
});
