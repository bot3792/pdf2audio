import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

const repoRoot = import.meta.dirname
  ? path.resolve(import.meta.dirname, "../../..")
  : path.resolve(process.cwd(), "../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3034),
  CONDA_ENV_PATH: z.string().default(path.join(repoRoot, ".venv", "bin")),
  DEEPSEEK_API_KEY: z.string().optional(),
  CARTESIA_API_KEY: z.string().optional(),
  READALOUD_DROP_DIR: z.string().optional(),
});

export const env = envSchema.parse(process.env);
