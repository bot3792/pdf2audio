import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

function lmsBinary(): string | null {
  const candidates = [path.join(os.homedir(), ".cache", "lm-studio", "bin", "lms"), path.join(os.homedir(), ".lmstudio", "bin", "lms")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export async function startLocalServer(name: "Ollama" | "LM Studio"): Promise<void> {
  if (name === "LM Studio") {
    const lms = lmsBinary();
    if (!lms) {
      throw new Error("LM Studio's `lms` CLI was not found — is LM Studio installed? (lmstudio.ai)");
    }
    await exec(lms, ["server", "start"], { timeout: 20_000 });
    return;
  }
  // The Ollama app serves on launch
  try {
    await exec("open", ["-a", "Ollama"], { timeout: 10_000 });
  } catch {
    throw new Error("Ollama was not found — install it from ollama.com");
  }
  // Give the server a moment to bind before the caller rescans
  await new Promise((r) => setTimeout(r, 1_500));
}
