import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const ENV_PATH = path.join(repoRoot, ".env");

let envFile: string | undefined;
function envValue(name: string): string | undefined {
  envFile ??= fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  return envFile.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1];
}

export const API_URL = process.env.E2E_API_URL ?? `http://localhost:${envValue("PORT") ?? "3034"}`;

// The server resolves DATA_DIR relative to packages/server (its cwd under pnpm dev)
export const LLM_MODELS_PATH = path.resolve(
  repoRoot,
  "packages/server",
  envValue("DATA_DIR") ?? "./data",
  "llm-models.json",
);
