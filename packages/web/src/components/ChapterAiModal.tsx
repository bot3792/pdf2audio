import { useState } from "react";
import Markdown from "react-markdown";
import { trpc } from "../trpc.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";

const MODELS = [
  { key: "flash", label: "V4 Flash", hint: "Fast and cheap — good default", contextTokens: 1_000_000 },
  { key: "pro", label: "V4 Pro", hint: "Flagship reasoning model — slower, for harder questions", contextTokens: 1_000_000 },
] as const;

// No DeepSeek tokenizer in the browser — BPE rule of thumb: ~3.8 chars/token for
// ASCII text, ~1.6 for non-Latin scripts (Cyrillic etc.)
function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
  }
  const nonAscii = text.length - ascii;
  return Math.round(ascii / 3.8 + nonAscii / 1.6);
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${parseFloat((n / 1_000_000).toFixed(2))}M`;
}

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
  const [model, setModel] = useState<"flash" | "pro">("flash");
  const [result, setResult] = useState<string | null>(null);

  const aiMutation = trpc.chapters.aiPrompt.useMutation({
    onSuccess: (data) => setResult(data.result),
  });

  const { data: chapterDetail } = trpc.chapters.get.useQuery({ id: chapterId });
  const chapterText = chapterDetail
    ? (chapterDetail.customText ?? chapterDetail.cleanText ?? chapterDetail.rawText)
    : null;
  const activeModel = MODELS.find((m) => m.key === model)!;
  const chapterTokens = chapterText ? estimateTokens(chapterText) + estimateTokens(prompt) : null;
  const contextPct = chapterTokens ? (chapterTokens / activeModel.contextTokens) * 100 : null;

  function selectPreset(key: string) {
    const preset = PRESETS.find((p) => p.key === key)!;
    setActivePreset(key);
    setPrompt(preset.prompt);
  }

  function run() {
    if (!prompt.trim() || aiMutation.isPending) return;
    aiMutation.mutate({ chapterId, prompt: prompt.trim(), model });
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
            {chapterTokens !== null && contextPct !== null && (
              <div className="shrink-0" data-testid="ai-context-usage" title={`Rough estimate — chapter text plus your prompt, sent in full to ${activeModel.label}`}>
                <div className="flex items-baseline justify-between text-xs text-(--text-faint) mb-1">
                  <span>Sends ≈ {formatTokens(chapterTokens)} tokens</span>
                  <span>{contextPct < 0.1 ? "<0.1" : contextPct.toFixed(1)}% of {activeModel.label}'s {formatTokens(activeModel.contextTokens)} context</span>
                </div>
                <div className="h-1 rounded-full bg-(--bg-subtle) overflow-hidden">
                  <div
                    className={`h-full rounded-full ${contextPct > 80 ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${Math.min(100, Math.max(0.5, contextPct))}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex rounded-md border border-(--border) p-0.5 gap-0.5" data-testid="ai-model-toggle">
                {MODELS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setModel(m.key)}
                    title={m.hint}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium ${
                      model === m.key
                        ? "bg-(--bg-subtle) text-(--text-primary)"
                        : "text-(--text-muted) hover:text-(--text-secondary)"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                onClick={run}
                disabled={!prompt.trim() || aiMutation.isPending}
                title="Cmd+Enter"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="ai-run"
              >
                {aiMutation.isPending ? "Thinking..." : "Ask"}
              </button>
            </div>
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
                <div className="text-sm text-(--text-primary) leading-relaxed space-y-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-(--bg-subtle) [&_code]:px-1 [&_code]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-(--border) [&_blockquote]:pl-3 [&_blockquote]:text-(--text-tertiary)" data-testid="ai-result">
                  <Markdown>{result}</Markdown>
                </div>
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
