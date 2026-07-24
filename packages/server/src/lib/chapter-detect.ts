import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

import { env } from "../env.ts";

const CONDA_BIN = env.CONDA_ENV_PATH;

const DETECT_SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/detect_chapters.py"
);

export type ChapterBoundary = {
  title: string;
  page: number;
};

type LogFn = (message: string) => Promise<void>;

const TIMEOUT_MS = 600_000;

export async function detectChaptersWithLlm(
  markerJsonPath: string,
  pdfPath: string,
  log: LogFn
): Promise<ChapterBoundary[] | null> {
  return runDetection(markerJsonPath, pdfPath, log);
}

function runDetection(
  markerJsonPath: string,
  pdfPath: string,
  log: LogFn
): Promise<ChapterBoundary[] | null> {
  return new Promise((resolve) => {
    const pythonBin = path.join(CONDA_BIN, "python");
    const proc = spawn(pythonBin, [DETECT_SCRIPT, "--input", markerJsonPath, "--pdf", pdfPath], {
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        PATH: `${CONDA_BIN}:${process.env.PATH}`,
      },
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      log("LLM chapter detection timed out");
      resolve(null);
    }, TIMEOUT_MS);

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const stderrRl = createInterface({ input: proc.stderr });
    stderrRl.on("line", (line) => {
      log(`[LLM] ${line}`);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      stderrRl.close();

      if (code !== 0) {
        log(`LLM chapter detection failed (exit code ${code})`);
        resolve(null);
        return;
      }

      try {
        const chapters: ChapterBoundary[] = JSON.parse(stdout.trim());
        if (!Array.isArray(chapters) || chapters.length < 2) {
          resolve(null);
          return;
        }
        resolve(chapters);
      } catch {
        log("Failed to parse LLM output");
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      stderrRl.close();
      log(`LLM chapter detection error: ${err.message}`);
      resolve(null);
    });
  });
}
