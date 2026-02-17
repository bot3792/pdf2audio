import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const CONDA_BIN = process.env.CONDA_ENV_PATH ?? "/Users/petur/miniconda3/envs/pdf2audio/bin";

const SYNTHESIZE_SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/synthesize.py"
);

type SynthesizeOptions = {
  inputText: string;
  outputPath: string;
  voice: string;
  speed: number;
};

export async function synthesize({ inputText, outputPath, voice, speed }: SynthesizeOptions): Promise<void> {
  const textPath = outputPath.replace(/\.wav$/, ".txt");
  await writeFile(textPath, inputText, "utf-8");

  const pythonBin = path.join(CONDA_BIN, "python");

  const { stderr } = await execFileAsync(
    pythonBin,
    [SYNTHESIZE_SCRIPT, "--input", textPath, "--output", outputPath, "--voice", voice, "--speed", String(speed)],
    {
      timeout: 1_800_000,
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
        PATH: `${CONDA_BIN}:${process.env.PATH}`,
      },
    }
  );

  if (stderr && stderr.includes("Error")) {
    throw new Error(`Kokoro synthesis failed: ${stderr}`);
  }
}
