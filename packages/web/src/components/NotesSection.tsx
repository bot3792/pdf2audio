import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { MarkdownBlock } from "./MarkdownBlock.tsx";

export type NoteJobView = {
  status: "queued" | "running" | "done" | "failed";
  prompt: string;
  model: "flash" | "pro";
  error?: string;
  updatedAt: string;
};

const MODEL_LABELS = { flash: "V4 Flash", pro: "V4 Pro" } as const;

function noteJobActive(noteJob: NoteJobView | null): boolean {
  if (!noteJob) return false;
  if (noteJob.status !== "queued" && noteJob.status !== "running") return false;
  return Date.now() - new Date(noteJob.updatedAt).getTime() < 15 * 60_000;
}

export function NotesSection({ bookId, noteJob }: { bookId: string; noteJob: NoteJobView | null }) {
  const utils = trpc.useUtils();
  const jobActive = noteJobActive(noteJob);
  const { data: notes = [] } = trpc.notes.list.useQuery(
    { bookId },
    { refetchInterval: jobActive ? 2000 : false },
  );
  const deleteMutation = trpc.notes.delete.useMutation({
    onSuccess: () => utils.notes.list.invalidate({ bookId }),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const showFailedJob = noteJob?.status === "failed";
  if (notes.length === 0 && !jobActive && !showFailedJob) return null;

  return (
    <section className="mb-6 rounded-xl border border-(--border) border-t-2 border-t-sky-400/80 bg-(--bg-card) p-4" data-testid="notes-section">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold text-(--text-secondary)">
          <span className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider mr-2">Notes</span>
          AI answers
        </h2>
        <span className="text-sm text-(--text-muted)">{notes.length}</span>
      </div>

      {jobActive && (
        <div className="flex items-center gap-2 text-sm text-(--text-muted) mb-2" data-testid="note-job-running">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          AI is answering "{noteJob!.prompt.length > 80 ? noteJob!.prompt.slice(0, 80) + "..." : noteJob!.prompt}"...
        </div>
      )}
      {showFailedJob && (
        <div className="text-sm text-red-600 mb-2" data-testid="note-job-failed">
          Upload-time AI prompt failed: {noteJob!.error ?? "unknown error"}
        </div>
      )}

      <div className="divide-y divide-(--divide)">
        {notes.map((note) => {
          const expanded = expandedId === note.id;
          const scopeLabel =
            note.scope.kind === "book-raw"
              ? "Whole book (raw text)"
              : `${note.scope.chapters.length} chapter${note.scope.chapters.length === 1 ? "" : "s"}`;
          const scopeTitle = note.scope.kind === "chapters" ? note.scope.chapters.map((c) => c.title).join("\n") : undefined;
          return (
            <div key={note.id} className="py-2" data-testid="note-row">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExpandedId(expanded ? null : note.id)}
                  className="flex items-center gap-3 text-left group flex-1 min-w-0"
                >
                  <svg
                    className={`w-3 h-3 shrink-0 text-(--text-faint) transition-transform ${expanded ? "rotate-90" : ""}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
                  </svg>
                  <span className="text-sm text-(--text-primary) truncate flex-1 group-hover:text-(--text-secondary)">
                    {note.prompt}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-(--bg-subtle) text-(--text-muted) shrink-0" title={scopeTitle}>
                    {scopeLabel}
                  </span>
                  <span className="text-xs text-(--text-faint) shrink-0">{MODEL_LABELS[note.model]}</span>
                  <span className="text-xs text-(--text-faint) shrink-0">
                    {new Date(note.createdAt).toLocaleDateString()}
                  </span>
                </button>
                {note.scope.kind === "book-raw" && note.scope.digestBookId && (
                  <Link
                    to={`/books/${note.scope.digestBookId}`}
                    className="text-xs text-sky-600 hover:text-sky-800 shrink-0"
                    title="This summary is a chapter of a digest book — open it"
                  >
                    digest ↗
                  </Link>
                )}
              </div>
              {expanded && (
                <div className="mt-2 ml-6 space-y-2">
                  <MarkdownBlock testId="note-result">{note.result}</MarkdownBlock>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigator.clipboard.writeText(note.result)}
                      className="text-xs text-(--text-muted) hover:text-(--text-secondary) font-medium"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Delete this note?")) deleteMutation.mutate({ id: note.id });
                      }}
                      className="text-xs text-red-500 hover:text-red-600 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
