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

describe("tts KugelAudio dispatcher", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockWriteFile.mockClear();
    procs.length = 0;
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("runs the KugelAudio script with the default voice", async () => {
    const log = vi.fn(async () => {});

    const run = synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/out.wav",
      voice: "kugel:default",
      speed: 1,
      log,
    });

    await flushAsyncWork();

    expect(log).toHaveBeenCalledWith("Starting KugelAudio synthesis (2 words, voice: default, fixed speed)");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, spawnArgs] = mockSpawn.mock.calls[0] as unknown as [string, string[]];
    expect(spawnArgs[0]).toMatch(/synthesize_kugel_tts\.py$/);
    expect(spawnArgs).toContain("default");

    procs[0]?.emit("close", 0);
    await run;
  });

  it("serializes KugelAudio and BG MLX syntheses on the shared MLX queue", async () => {
    const first = synthesize({
      inputText: "Първи откъс.",
      outputPath: "/tmp/first.wav",
      voice: "kugel:default",
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
});
