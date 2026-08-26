import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

// Walking up from this file finds the repo when running from source, and finds nothing useful
// once the server is a bundle or a single executable — there, the launcher passes the root in.
const repoRoot = process.env.PDF2AUDIO_HOME
  ?? (import.meta.dirname ? path.resolve(import.meta.dirname, "../../..") : path.resolve(process.cwd(), "../.."));
export const envFilePath = path.join(repoRoot, ".env");
dotenv.config({ path: envFilePath });

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3034),
  CONDA_ENV_PATH: z.string().default(path.join(repoRoot, ".venv", "bin")),
  SCRIPTS_DIR: z.string().default(path.join(repoRoot, "scripts")),
  WEB_DIR: z.string().default(path.join(repoRoot, "packages", "web", "dist")),
  POCKET_ENV_PATH: z.string().default(path.join(repoRoot, ".venv-pocket", "bin")),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  LOCAL_LLM_URL: z.string().optional(),
  LOCAL_LLM_MODEL: z.string().optional(),
  LOCAL_LLM_LABEL: z.string().optional(),
  LOCAL_LLM_CONTEXT_TOKENS: z.coerce.number().default(32_768),
  LOCAL_LLM_TOOLS: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  CARTESIA_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default("eleven_multilingual_v2"),
  READALOUD_DROP_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);
