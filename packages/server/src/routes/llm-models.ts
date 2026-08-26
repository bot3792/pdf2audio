import { z } from "zod";
import { router, publicProcedure } from "../trpc.ts";
import { availableModels, llmStatus } from "../lib/llm.ts";
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
});
