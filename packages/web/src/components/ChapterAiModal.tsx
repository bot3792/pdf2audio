import { useState } from "react";
import { trpc } from "../trpc.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";

// The Summarize default mirrors Brave Leo's page-summary prompt, adapted to a chapter
const PRESETS = [
  {
    key: "summarize",
    label: "Summarize",
    prompt: "Provide a concise list of up to 6 bullets on the most important points of this chapter, followed by a one-paragraph summary.",
  },
  {
    key: "questions",
    label: "Suggest questions",
    prompt: "List 8 insightful questions a curious reader could ask about this chapter. Only list the questions — I will pick one to ask next.",
  },
  {
    key: "explain",
    label: "Explain simply",
    prompt: "Explain the main ideas and argument of this chapter in plain, simple language.",
  },
  {
    key: "entities",
    label: "People & terms",
    prompt: "List the key people, places, and terms mentioned in this chapter, each with a one-line description of who or what they are.",
  },
] as const;

export function ChapterAiModal({
  chapterId,
  chapterTitle,
  onClose,
}: {
  chapterId: string;
  chapterTitle: string;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const [activePreset, setActivePreset] = useState<string>("summarize");
  const [prompt, setPrompt] = useState<string>(PRESETS[0].prompt);
  const [result, setResult] = useState<string | null>(null);

  const aiMutation = trpc.chapters.aiPrompt.useMutation({
    onSuccess: (data) => setResult(data.result),
  });

  function selectPreset(key: string) {
    const preset = PRESETS.find((p) => p.key === key)!;
    setActivePreset(key);
    setPrompt(preset.prompt);
  }

  function run() {
    if (!prompt.trim() || aiMutation.isPending) return;
    aiMutation.mutate({ chapterId, prompt: prompt.trim() });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="chapter-ai-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <span className="text-sm font-medium text-(--text-primary)">
            Ask about <span className="text-(--text-muted)">"{chapterTitle}"</span>
          </span>
          <button onClick={onClose} className="text-(--text-faint) hover:text-(--text-tertiary) p-1" title="Close">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left: presets + prompt */}
          <div className="w-2/5 border-r border-(--border) p-4 flex flex-col gap-3 min-h-0">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => selectPreset(p.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    activePreset === p.key
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
              }}
              className="flex-1 resize-none rounded-md border border-(--border-input) bg-(--bg-input) p-3 text-sm text-(--text-primary) leading-relaxed focus:outline-none focus:border-blue-500"
              placeholder="Ask anything about this chapter..."
              data-testid="ai-prompt-input"
            />
            <button
              onClick={run}
              disabled={!prompt.trim() || aiMutation.isPending}
              title="Cmd+Enter"
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              data-testid="ai-run"
            >
              {aiMutation.isPending ? "Thinking..." : "Ask"}
            </button>
          </div>

          {/* Right: result */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              {aiMutation.isPending ? (
                <div className="flex items-center gap-2 text-sm text-(--text-muted)">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  DeepSeek is reading the chapter...
                </div>
              ) : aiMutation.isError ? (
                <p className="text-sm text-red-600 whitespace-pre-wrap">{aiMutation.error.message}</p>
              ) : result ? (
                <p className="text-sm text-(--text-primary) whitespace-pre-wrap leading-relaxed" data-testid="ai-result">
                  {result}
                </p>
              ) : (
                <p className="text-sm text-(--text-faint)">
                  Pick a preset or write your own prompt, then hit Ask. The full chapter text is sent along with it.
                </p>
              )}
            </div>
            {result && !aiMutation.isPending && (
              <div className="border-t border-(--border) px-4 py-2 shrink-0">
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="text-xs text-(--text-muted) hover:text-(--text-secondary) font-medium"
                >
                  Copy result
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
