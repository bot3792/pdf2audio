import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

const envPath = import.meta.dirname
  ? path.resolve(import.meta.dirname, "../../../.env")
  : path.resolve(process.cwd(), "../../.env");
dotenv.config({ path: envPath });

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3034),
  CONDA_ENV_PATH: z.string().default("/Users/petur/miniconda3/envs/pdf2audio/bin"),
});

export const env = envSchema.parse(process.env);
