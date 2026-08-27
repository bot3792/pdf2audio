import { trpc } from "../trpc.ts";
import type { RouterOutputs } from "../../../server/src/router.ts";

export type LlmModel = RouterOutputs["llmModels"]["list"][number];

export function useLlmModels(): LlmModel[] {
  const { data } = trpc.llmModels.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  return data ?? [];
}

// The key a request with no explicit pick resolves to — the user's Settings choice when its
// model is available, otherwise the automatic one. Pickers preselect it via ModelPicker.
export function useDefaultModelKey(): string | null {
  const { data } = trpc.llmModels.getDefault.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  return data?.resolved ?? null;
}

export function useActiveLlmModel(key: string): LlmModel | undefined {
  const models = useLlmModels();
  const defaultKey = useDefaultModelKey();
  return models.find((m) => m.key === key) ?? models.find((m) => m.key === defaultKey) ?? models[0];
}
