import { useState } from "react";
import { trpc } from "../trpc.ts";
import { MarkdownBlock } from "./MarkdownBlock.tsx";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";
import {
  AI_MODELS,
  AI_PRESETS,
  estimateTokens,
  estimateTokensFromCounts,
  formatTokens,
  type AiModelKey,
} from "../lib/ai-presets.ts";

export type AiScope =
  | { kind: "chapters"; bookId: string; chapters: { id: string; title: string }[] }
  | { kind: "book-raw"; bookId: string; bookTitle: string };

export function ChapterAiModal({ scope, onClose }: { scope: AiScope; onClose: () => void }) {
  useBodyScrollLock();
  const utils = trpc.useUtils();
  const subject = scope.kind === "book-raw" ? "book" : scope.chapters.length === 1 ? "chapter" : "chapters";
  const [activePreset, setActivePreset] = useState<string>("summarize");
  const [prompt, setPrompt] = useState<string>(AI_PRESETS[0].prompt(subject));
  const [model, setModel] = useState<AiModelKey>("flash");
  const [result, setResult] = useState<string | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  const onAskSuccess = (data: { result: string; noteId?: string }) => {
    setResult(data.result);
    setSavedNoteId(data.noteId ?? null);
    if (data.noteId) utils.notes.list.invalidate({ bookId: scope.bookId });
  };
  const chapterMutation = trpc.chapters.aiPrompt.useMutation({ onSuccess: onAskSuccess });
  const rawMutation = trpc.books.aiPromptRaw.useMutation({ onSuccess: onAskSuccess });
  const aiMutation = scope.kind === "book-raw" ? rawMutation : chapterMutation;

  const chapterIds = scope.kind === "chapters" ? scope.chapters.map((c) => c.id) : [];
  const { data: chapterStats } = trpc.chapters.textStats.useQuery(
    { chapterIds },
    { enabled: scope.kind === "chapters" },
  );
  const { data: rawStats } = trpc.books.rawTextStats.useQuery(
    { bookId: scope.bookId },
    { enabled: scope.kind === "book-raw" },
  );
  const textStats = scope.kind === "book-raw" ? rawStats : chapterStats;

  const activeModel = AI_MODELS.find((m) => m.key === model)!;
  const contentTokens = textStats
    ? estimateTokensFromCounts(textStats.ascii, textStats.nonAscii) + estimateTokens(prompt)
    : null;
  const contextPct = contentTokens ? (contentTokens / activeModel.contextTokens) * 100 : null;
  const overContext = contextPct !== null && contextPct > 100;

  const headerLabel =
    scope.kind === "book-raw"
      ? `"${scope.bookTitle}" (whole book, raw text)`
      : scope.chapters.length === 1
        ? `"${scope.chapters[0].title}"`
        : `${scope.chapters.length} selected chapters`;
  const headerTitle = scope.kind === "chapters" ? scope.chapters.map((c) => c.title).join("\n") : undefined;

  function selectPreset(key: string) {
    const preset = AI_PRESETS.find((p) => p.key === key)!;
    setActivePreset(key);
    setPrompt(preset.prompt(subject));
  }

  function run() {
    if (!prompt.trim() || aiMutation.isPending || overContext) return;
    if (scope.kind === "book-raw") {
      rawMutation.mutate({ bookId: scope.bookId, prompt: prompt.trim(), model });
    } else {
      chapterMutation.mutate({ chapterIds, prompt: prompt.trim(), model });
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="chapter-ai-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <span className="text-sm font-medium text-(--text-primary)" title={headerTitle}>
            Ask about <span className="text-(--text-muted)">{headerLabel}</span>
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
              {AI_PRESETS.map((p) => (
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
              placeholder={`Ask anything about this ${subject === "chapters" ? "selection" : subject}...`}
              data-testid="ai-prompt-input"
            />
            {contentTokens !== null && contextPct !== null && (
              <div className="shrink-0" data-testid="ai-context-usage" title={`Rough estimate — the ${subject === "book" ? "book's raw text" : "chapter text"} plus your prompt, sent in full to ${activeModel.label}`}>
                <div className="flex items-baseline justify-between text-xs text-(--text-faint) mb-1">
                  <span>
                    Sends up to ≈ {formatTokens(contentTokens)} tokens
                    {scope.kind === "chapters" && scope.chapters.length > 1 ? ` (${scope.chapters.length} chapters)` : ""}
                    {scope.kind === "book-raw" && rawStats && rawStats.missingFiles > 0 ? ` (${rawStats.missingFiles} file(s) without raw text excluded)` : ""}
                  </span>
                  <span className={overContext ? "text-red-500 font-medium" : ""}>
                    {contextPct < 0.1 ? "<0.1" : contextPct.toFixed(1)}% of {activeModel.label}'s {formatTokens(activeModel.contextTokens)} context
                  </span>
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
                {AI_MODELS.map((m) => (
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
                disabled={!prompt.trim() || aiMutation.isPending || overContext}
                title={overContext ? `The ${subject === "book" ? "book's raw text" : "selected chapters"} exceed this model's context window` : "Cmd+Enter"}
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
                  DeepSeek is reading the {subject === "book" ? "book" : "chapter"}...
                </div>
              ) : aiMutation.isError ? (
                <p className="text-sm text-red-600 whitespace-pre-wrap">{aiMutation.error.message}</p>
              ) : result ? (
                <MarkdownBlock testId="ai-result">{result}</MarkdownBlock>
              ) : (
                <p className="text-sm text-(--text-faint)">
                  Pick a preset or write your own prompt, then hit Ask. The full {subject === "book" ? "raw book text" : "chapter text"} is sent along with it.
                </p>
              )}
            </div>
            {result && !aiMutation.isPending && (
              <div className="border-t border-(--border) px-4 py-2 shrink-0 flex items-center gap-3">
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="text-xs text-(--text-muted) hover:text-(--text-secondary) font-medium"
                >
                  Copy result
                </button>
                {savedNoteId && (
                  <span className="text-xs text-green-600 dark:text-green-400" data-testid="ai-saved-note">
                    Saved to notes
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
