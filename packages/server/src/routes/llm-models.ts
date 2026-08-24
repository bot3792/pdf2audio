import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { availableModels, llmStatus, setCloudKey, CLOUD_KEY_VARS } from "../lib/llm.ts";
import { startLocalServer } from "../lib/llm-server-control.ts";

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

  startLocalServer: publicProcedure
    .input(z.object({ name: z.enum(["Ollama", "LM Studio"]) }))
    .mutation(({ input }) => startLocalServer(input.name)),

  // Key values are written to .env and never sent back to the client (only …last4)
  setKey: publicProcedure
    .input(z.object({ envVar: z.enum(CLOUD_KEY_VARS), value: z.string().max(256).nullable() }))
    .mutation(({ input }) => {
      setCloudKey(input.envVar, input.value);
    }),
});
