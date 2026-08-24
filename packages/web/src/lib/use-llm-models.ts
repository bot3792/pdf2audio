import { trpc } from "../trpc.ts";
import type { RouterOutputs } from "../../../server/src/router.ts";

export type LlmModel = RouterOutputs["llmModels"]["list"][number];

export function useLlmModels(): LlmModel[] {
  const { data } = trpc.llmModels.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  return data ?? [];
}

export function useActiveLlmModel(key: string): LlmModel | undefined {
  const models = useLlmModels();
  return models.find((m) => m.key === key) ?? models[0];
}
