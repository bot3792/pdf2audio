import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../env.ts";
import { chunkTextForBulgarianNarrator } from "./tts-chunks.ts";
import { synthesize as kokoroSynthesize, KokoroAbortedError } from "./kokoro.ts";

const CONDA_BIN = env.CONDA_ENV_PATH;
const BG_MLX_SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/synthesize_bg_tts_mlx.py");
const BG_MMS_SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/synthesize_mms_tts.py");

type LogFn = (message: string) => Promise<void>;
type ProgressFn = (chunk: number, totalChunks: number) => Promise<void>;

type SynthesizeOptions = {
  inputText: string;
  outputPath: string;
  voice: string;
  speed: number;
  log?: LogFn;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
};

type ParsedTtsVoice = {
  engine: "kokoro" | "bg-mlx" | "bg-mms";
  voice: string;
  raw: string;
};

const noopLog: LogFn = async () => {};
const noopProgress: ProgressFn = async () => {};

const ENGLISH_PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with my whole heart.";
const BULGARIAN_PREVIEW_TEXT = "В тиха пролетна утрин светът изглеждаше мек и ясен, а гласът на разказвача трябваше да носи спокойствие, ритъм и увереност през всяка страница.";
const BG_MLX_VOICES = new Set(["narrator"]);
const BG_MMS_VOICES = new Set(["bul"]);
const KOKORO_VOICE_PATTERN = /^[a-z]{2}_[a-z]+$/;

export class TtsAbortedError extends Error {
  constructor() {
    super("TTS synthesis aborted");
    this.name = "TtsAbortedError";
  }
}

export function parseTtsVoice(rawVoice: string): ParsedTtsVoice {
  if (rawVoice.startsWith("kokoro:")) {
    const voice = rawVoice.slice("kokoro:".length);
    if (!KOKORO_VOICE_PATTERN.test(voice)) {
      throw new Error(`Unsupported voice ID: ${rawVoice}`);
    }
    return { engine: "kokoro", voice, raw: rawVoice };
  }

  if (rawVoice.startsWith("bg-mlx:")) {
    const voice = rawVoice.slice("bg-mlx:".length);
    if (!BG_MLX_VOICES.has(voice)) {
      throw new Error(`Unsupported voice ID: ${rawVoice}`);
    }
    return { engine: "bg-mlx", voice, raw: rawVoice };
  }

  if (rawVoice.startsWith("bg-mms:")) {
    const voice = rawVoice.slice("bg-mms:".length);
    if (!BG_MMS_VOICES.has(voice)) {
      throw new Error(`Unsupported voice ID: ${rawVoice}`);
    }
    return { engine: "bg-mms", voice, raw: rawVoice };
  }

  if (rawVoice.includes(":")) {
    throw new Error(`Unsupported voice ID: ${rawVoice}`);
  }

  if (!KOKORO_VOICE_PATTERN.test(rawVoice)) {
    throw new Error(`Unsupported voice ID: ${rawVoice}`);
  }

  return { engine: "kokoro", voice: rawVoice, raw: rawVoice };
}

export function getPreviewTextForVoice(voice: string): string {
  return parseTtsVoice(voice).engine === "kokoro" ? ENGLISH_PREVIEW_TEXT : BULGARIAN_PREVIEW_TEXT;
}

export function voiceSupportsSpeed(voice: string): boolean {
  return parseTtsVoice(voice).engine === "kokoro";
}

export async function synthesize({ inputText, outputPath, voice, speed, log = noopLog, onProgress = noopProgress, signal }: SynthesizeOptions): Promise<void> {
  const resolved = parseTtsVoice(voice);

  if (resolved.engine === "kokoro") {
    try {
      await kokoroSynthesize({ inputText, outputPath, voice: resolved.voice, speed, log, onProgress, signal });
      return;
    } catch (error) {
      if (error instanceof KokoroAbortedError) {
        throw new TtsAbortedError();
      }
      throw error;
    }
  }

  if (resolved.engine === "bg-mlx") {
    await synthesizeBulgarianBackend({
      backendName: "Bulgarian MLX",
      scriptPath: BG_MLX_SCRIPT,
      inputText,
      outputPath,
      voice: resolved.voice,
      speed,
      log,
      onProgress,
      signal,
    });
    return;
  }

  await synthesizeBulgarianBackend({
    backendName: "Bulgarian MMS",
    scriptPath: BG_MMS_SCRIPT,
    inputText,
    outputPath,
    voice: resolved.voice,
    speed,
    log,
    onProgress,
    signal,
  });
}

async function synthesizeBulgarianBackend({
  backendName,
  scriptPath,
  inputText,
  outputPath,
  voice,
  log = noopLog,
  onProgress = noopProgress,
  signal,
}: SynthesizeOptions & {
  backendName: string;
  scriptPath: string;
}): Promise<void> {
  const chunks = chunkTextForBulgarianNarrator(inputText);
  if (chunks.length === 0) {
    throw new Error("Bulgarian narrator input is empty after chunking");
  }

  const textPath = outputPath.replace(/\.wav$/, ".txt");
  await writeFile(textPath, chunks.join("\f"), "utf-8");

  const pythonBin = path.join(CONDA_BIN, "python");
  const wordCount = inputText.split(/\s+/).filter(Boolean).length;
  await log(`Starting ${backendName} synthesis (${wordCount.toLocaleString()} words, voice: ${voice}, fixed speed)`);

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TtsAbortedError());
      return;
    }

    const proc = spawn(
      pythonBin,
      [scriptPath, "--input", textPath, "--output", outputPath, "--voice", voice],
      {
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
          PATH: `${CONDA_BIN}:${process.env.PATH}`,
        },
      }
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${backendName} synthesis timed out after 3 hours`));
    }, 3 * 60 * 60 * 1000);

    let aborted = false;
    const handleAbort = () => {
      aborted = true;
      proc.kill("SIGKILL");
    };
    signal?.addEventListener("abort", handleAbort);

    let stderrBuf = "";
    const stdoutRl = createInterface({ input: proc.stdout });
    stdoutRl.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.type === "chunks") {
          void log(`Prepared ${data.total} ${backendName} chunks`);
        } else if (data.type === "progress") {
          void log(`Chunk ${data.chunk}/${data.totalChunks} — ${data.audioSeconds}s of audio`);
          void onProgress(data.chunk, data.totalChunks);
        } else if (data.type === "done") {
          void log(`Synthesis complete — ${data.audioSeconds}s of audio in ${data.chunks} chunks`);
        }
      } catch {
        // Ignore non-JSON stdout.
      }
    });

    const stderrRl = createInterface({ input: proc.stderr });
    stderrRl.on("line", (line) => {
      stderrBuf += line + "\n";
      if (line.includes("Error") || line.includes("Traceback")) {
        void log(`stderr: ${line.trim()}`);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      stdoutRl.close();
      stderrRl.close();
      signal?.removeEventListener("abort", handleAbort);

      if (aborted) {
        reject(new TtsAbortedError());
        return;
      }

      if (code !== 0) {
        reject(new Error(`${backendName} synthesis failed: ${stderrBuf.trim()}`));
        return;
      }

      resolve();
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      stdoutRl.close();
      stderrRl.close();
      signal?.removeEventListener("abort", handleAbort);

      if (aborted) {
        reject(new TtsAbortedError());
        return;
      }

      reject(error);
    });
  });
}
