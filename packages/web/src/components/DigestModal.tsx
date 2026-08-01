import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "../trpc.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";
import { AI_MODELS, DIGEST_LISTENING_PROMPT, type AiModelKey } from "../lib/ai-presets.ts";

export function DigestModal({
  sourceBooks,
  folderId = null,
  onClose,
}: {
  sourceBooks: { id: string; title: string }[];
  folderId?: string | null;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const navigate = useNavigate();
  const [title, setTitle] = useState(`Digest — ${sourceBooks.length} books`);
  const [prompt, setPrompt] = useState(DIGEST_LISTENING_PROMPT);
  const [model, setModel] = useState<AiModelKey>("flash");

  const createMutation = trpc.books.createDigest.useMutation({
    onSuccess: (book) => navigate(`/books/${book.id}`),
  });

  function create() {
    if (!title.trim() || !prompt.trim() || createMutation.isPending) return;
    createMutation.mutate({
      title: title.trim(),
      sourceBookIds: sourceBooks.map((b) => b.id),
      prompt: prompt.trim(),
      model,
      folderId,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="digest-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <span className="text-sm font-medium text-(--text-primary)">
            Create digest from {sourceBooks.length} books
          </span>
          <button onClick={onClose} className="text-(--text-faint) hover:text-(--text-tertiary) p-1" title="Close">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm text-(--text-secondary) mb-1">Digest title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary)"
              data-testid="digest-title"
            />
          </div>

          <div>
            <label className="block text-sm text-(--text-secondary) mb-1">
              Summary prompt <span className="text-(--text-faint)">— runs once per book; each answer becomes a chapter</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={4000}
              className="w-full resize-y rounded-md border border-(--border-input) bg-(--bg-input) p-2.5 text-sm text-(--text-primary) leading-relaxed focus:outline-none focus:border-blue-500"
              data-testid="digest-prompt"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-(--text-secondary)">Model</span>
            <div className="inline-flex rounded-md border border-(--border) p-0.5 gap-0.5">
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
          </div>

          <div>
            <p className="text-sm text-(--text-secondary) mb-1">Chapters, in order</p>
            <ol className="text-sm text-(--text-muted) list-decimal pl-5 space-y-0.5">
              {sourceBooks.map((b) => (
                <li key={b.id} className="truncate" title={b.title}>{b.title}</li>
              ))}
            </ol>
          </div>

          {createMutation.error && (
            <p className="text-sm text-red-600 whitespace-pre-wrap">{createMutation.error.message}</p>
          )}
        </div>

        <div className="border-t border-(--border) px-4 py-3 shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-(--text-faint)">
            Summaries run in the background (~1-2 min per book). Chapters arrive suspended — review, pick a voice, then synthesize.
          </p>
          <button
            onClick={create}
            disabled={!title.trim() || !prompt.trim() || createMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            data-testid="digest-create"
          >
            {createMutation.isPending ? "Creating..." : "Create digest"}
          </button>
        </div>
      </div>
    </div>
  );
}
