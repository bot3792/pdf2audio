import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const { mockWriteFile, mockSpawn, procs } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(async () => {}),
  procs: [] as MockProc[],
  mockSpawn: vi.fn(() => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const proc = new EventEmitter() as MockProc;

    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = vi.fn();

    procs.push(proc);
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

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

describe("tts BG MLX dispatcher", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockWriteFile.mockClear();
    procs.length = 0;
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("serializes BG MLX syntheses so only one Python process runs at a time", async () => {
    const first = synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/first.wav",
      voice: "bg-mlx:narrator",
      speed: 1,
    });

    await flushAsyncWork();

    const second = synthesize({
      inputText: "Втори откъс.",
      outputPath: "/tmp/second.wav",
      voice: "bg-mlx:narrator",
      speed: 1,
    });

    await flushAsyncWork();

    expect(mockSpawn).toHaveBeenCalledTimes(1);

    procs[0]?.emit("close", 0);
    await flushAsyncWork();

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    procs[1]?.emit("close", 0);

    await first;
    await second;
  });

  it("logs the preview base URL for BG chunk files", async () => {
    const log = vi.fn(async () => {});

    const run = synthesize({
      inputText: "дума ".repeat(70).trim(),
      outputPath: "/tmp/out.wav",
      voice: "bg-mlx:narrator",
      speed: 1,
      chunkPreviewUrlBase: "/files/book/chunks/ch000",
      log,
    });

    await flushAsyncWork();

    expect(log).toHaveBeenCalledWith("Starting Bulgarian MLX synthesis (70 words, voice: narrator, fixed speed)");
    expect(log).toHaveBeenCalledWith("Chunk previews: /files/book/chunks/ch000/chunk-001.wav");
    expect(consoleLogSpy).not.toHaveBeenCalled();

    procs[0]?.emit("close", 0);
    await run;
  });
});
