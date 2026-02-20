import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const CONDA_BIN = process.env.CONDA_ENV_PATH ?? "/Users/petur/miniconda3/envs/pdf2audio/bin";

const SYNTHESIZE_SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/synthesize.py"
);

type LogFn = (message: string) => Promise<void>;
type ProgressFn = (chunk: number, totalChunks: number) => Promise<void>;

const noopLog: LogFn = async () => {};
const noopProgress: ProgressFn = async () => {};

type SynthesizeOptions = {
  inputText: string;
  outputPath: string;
  voice: string;
  speed: number;
  log?: LogFn;
  onProgress?: ProgressFn;
};

export async function synthesize({ inputText, outputPath, voice, speed, log = noopLog, onProgress = noopProgress }: SynthesizeOptions): Promise<void> {
  const textPath = outputPath.replace(/\.wav$/, ".txt");
  await writeFile(textPath, inputText, "utf-8");

  const pythonBin = path.join(CONDA_BIN, "python");
  const wordCount = inputText.split(/\s+/).filter(Boolean).length;
  await log(`Starting Kokoro synthesis (${wordCount.toLocaleString()} words, voice: ${voice}, speed: ${speed}x)`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      pythonBin,
      [SYNTHESIZE_SCRIPT, "--input", textPath, "--output", outputPath, "--voice", voice, "--speed", String(speed)],
      {
        env: {
          ...process.env,
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
          PATH: `${CONDA_BIN}:${process.env.PATH}`,
        },
      }
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Kokoro synthesis timed out after 30 minutes"));
    }, 1_800_000);

    let totalChunks = 0;
    const stdoutRl = createInterface({ input: proc.stdout });
    stdoutRl.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.type === "chunks") {
          totalChunks = data.total;
          log(`Phonemized into ${totalChunks} chunks`);
        } else if (data.type === "progress") {
          log(`Chunk ${data.chunk}/${data.totalChunks} — ${data.audioSeconds}s of audio`);
          onProgress(data.chunk, data.totalChunks);
        } else if (data.type === "done") {
          log(`Synthesis complete — ${data.audioSeconds}s of audio in ${data.chunks} chunks`);
        }
      } catch {}
    });

    let stderrBuf = "";
    const stderrRl = createInterface({ input: proc.stderr });
    stderrRl.on("line", (line) => {
      stderrBuf += line + "\n";
      if (line.includes("Error") || line.includes("Traceback")) {
        log(`stderr: ${line.trim()}`);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      stdoutRl.close();
      stderrRl.close();
      if (code !== 0) {
        reject(new Error(`Kokoro synthesis failed: ${stderrBuf.trim()}`));
      } else if (stderrBuf.includes("Error")) {
        reject(new Error(`Kokoro synthesis failed: ${stderrBuf.trim()}`));
      } else {
        resolve();
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      stdoutRl.close();
      stderrRl.close();
      reject(err);
    });
  });
}
