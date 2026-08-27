import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { availableModels, defaultModelKey, llmStatus, modelKeySchema } from "../lib/llm.ts";
import { startLocalServer } from "../lib/llm-server-control.ts";
import { env, envFilePath } from "../env.ts";
import { updateEnvFile } from "../lib/env-file.ts";

export const llmModelsRouter = router({
  list: publicProcedure.query(async () =>
    (await availableModels()).map(({ key, label, hint, source, contextTokens, supportsTools }) => ({
      key,
      label,
      hint,
      source,
      contextTokens,
      supportsTools,
    })),
  ),

  status: publicProcedure.query(() => llmStatus()),

  // chosen: what the user picked in Settings (null = automatic); resolved: what a request
  // with no explicit model will actually use right now — the pickers preselect this.
  getDefault: publicProcedure.query(async () => ({
    chosen: env.DEFAULT_LLM_MODEL ?? null,
    resolved: (await defaultModelKey()) ?? null,
  })),

  // Persisted the same way API keys are: written to the .env file and applied to the
  // in-memory env, so it survives restarts without needing one.
  setDefault: publicProcedure
    .input(z.object({ key: modelKeySchema.nullable() }))
    .mutation(({ input }) => {
      updateEnvFile(envFilePath, "DEFAULT_LLM_MODEL", input.key);
      env.DEFAULT_LLM_MODEL = input.key ?? undefined;
    }),

  startLocalServer: publicProcedure
    .input(z.object({ name: z.enum(["Ollama", "LM Studio"]) }))
    .mutation(({ input }) => startLocalServer(input.name)),
});
