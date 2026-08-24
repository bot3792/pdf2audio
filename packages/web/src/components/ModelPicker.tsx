import { memo, useEffect } from "react";
import { useLlmModels } from "../lib/use-llm-models.ts";
import { formatTokens } from "../lib/ai-presets.ts";

export const ModelPicker = memo(function ModelPicker({
  value,
  onChange,
  requireTools = false,
  testId,
}: {
  value: string;
  onChange: (key: string) => void;
  // library chat needs tool calling; models without it stay visible but disabled
  requireTools?: boolean;
  testId?: string;
}) {
  const models = useLlmModels();
  const usable = (key: string) => {
    const m = models.find((entry) => entry.key === key);
    return m !== undefined && (!requireTools || m.supportsTools);
  };

  useEffect(() => {
    if (models.length === 0 || usable(value)) return;
    const fallback = models.find((m) => !requireTools || m.supportsTools);
    if (fallback) onChange(fallback.key);
  }, [models, value, requireTools, onChange]);

  const active = models.find((m) => m.key === value);
  return (
    <select
      value={active?.key ?? ""}
      onChange={(e) => onChange(e.target.value)}
      title={active?.hint}
      disabled={models.length === 0}
      className="text-sm rounded-md border border-(--border) bg-(--bg-card) text-(--text-primary) px-2 py-1.5 max-w-60 truncate"
      data-testid={testId}
    >
      {models.length === 0 && <option value="">No AI model available</option>}
      {[...new Set(models.map((m) => m.source))].map((source) => (
        <optgroup key={source} label={source}>
          {models
            .filter((m) => m.source === source)
            .map((m) => (
              <option key={m.key} value={m.key} disabled={requireTools && !m.supportsTools} title={`${m.hint} · ${formatTokens(m.contextTokens)} context`}>
                {m.label}
                {requireTools && !m.supportsTools ? " (no chat tools)" : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
});
