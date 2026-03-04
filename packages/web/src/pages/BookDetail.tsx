import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { PipelineSteps } from "../components/PipelineSteps.tsx";
import { ChapterTable } from "../components/ChapterTable.tsx";

export function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: book, isLoading } = trpc.books.get.useQuery(
    { id: id! },
    {
      enabled: !!id,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status) return 3000;
        return status === "done" || status === "failed" || status === "suspended"
          ? false
          : 2000;
      },
    }
  );

  const invalidate = () => {
    utils.books.get.invalidate({ id: id! });
    utils.books.assemblies.invalidate({ bookId: id! });
  };

  const { data: bookAssemblies = [] } = trpc.books.assemblies.useQuery(
    { bookId: id! },
    { enabled: !!id },
  );

  const cancelMutation = trpc.books.cancel.useMutation({ onSuccess: invalidate });
  const retryMutation = trpc.books.retry.useMutation({ onSuccess: invalidate });
  const redetectMutation = trpc.books.redetectChapters.useMutation({ onSuccess: invalidate });
  const processSelectedMutation = trpc.books.processSelected.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.books.delete.useMutation({
    onSuccess: () => window.location.assign("/"),
  });
  const queueMutation = trpc.chapters.queue.useMutation({ onSuccess: invalidate });
  const suspendMutation = trpc.chapters.suspend.useMutation({ onSuccess: invalidate });
  const assembleMutation = trpc.books.assemble.useMutation({ onSuccess: invalidate });
  const deleteAssemblyMutation = trpc.books.deleteAssembly.useMutation({ onSuccess: invalidate });
  const setSelectedMutation = trpc.chapters.setSelected.useMutation({ onSuccess: invalidate });
  const setAllSelectedMutation = trpc.chapters.setAllSelected.useMutation({ onSuccess: invalidate });
  const setSelectedBatchMutation = trpc.chapters.setSelectedBatch.useMutation({ onSuccess: invalidate });

  const [reExtractForceOcr, setReExtractForceOcr] = useState<boolean | null>(null);
  const [reExtractLlm, setReExtractLlm] = useState<boolean | null>(null);

  if (isLoading || !book) {
    return (
      <div className="min-h-screen bg-(--bg-page)">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-(--text-muted)">Loading...</p>
        </div>
      </div>
    );
  }

  const doneChapters = book.chapters.filter((c) => c.status === "done").length;
  const selectedCount = book.chapters.filter((c) => c.selected).length;
  const isProcessing = ["extracting", "synthesizing", "assembling", "normalizing"].includes(book.status);
  const selectedWithAudio = book.chapters.filter((c) => c.selected && c.status === "done" && c.audioPath).length;
  const selectedNotDone = book.chapters.filter(
    (c) => c.selected && (c.status === "failed" || c.status === "suspended" || c.status === "pending")
  ).length;
  const canAssemble = selectedWithAudio > 0 && !isProcessing;
  const canProcess = selectedNotDone > 0 && !isProcessing;

  return (
    <div className="min-h-screen bg-(--bg-page)">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block">
          &larr; Back
        </Link>

        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-(--text-primary)">{book.title}</h1>
            <p className="text-sm text-(--text-muted) mt-1">
              {book.filename} &middot; Voice: {book.voice} &middot; Speed: {book.speed}x
              &middot; 4 worker slots
            </p>
          </div>
          <StatusBadge
            status={book.status}
            error={book.error}
            chaptersCompleted={doneChapters}
            totalChapters={book.totalChapters}
          />
        </div>

        <div className="mb-6">
          <PipelineSteps
            status={book.status}
            chaptersCompleted={doneChapters}
            totalChapters={book.totalChapters}
          />
        </div>

        {book.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700 font-mono">{book.error}</p>
          </div>
        )}

        {isProcessing && book.totalChapters > 0 && (
          <ProgressSection
            status={book.status}
            doneChapters={doneChapters}
            totalChapters={book.totalChapters}
            chapters={book.chapters}
          />
        )}

        <StatsBar
          status={book.status}
          totalChapters={book.totalChapters}
          totalWords={book.totalWords}
          totalDurationMs={book.totalDurationMs}
          createdAt={book.createdAt}
          updatedAt={book.updatedAt}
        />

        <LogViewer bookId={book.id} bookStatus={book.status} />

        <div className="flex gap-3 mb-6">
          {canProcess ? (
            <button
              onClick={() => processSelectedMutation.mutate({ id: book.id })}
              disabled={processSelectedMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Process selected ({selectedNotDone})
            </button>
          ) : null}
          {canAssemble ? (
            <button
              onClick={() => assembleMutation.mutate({ id: book.id })}
              disabled={assembleMutation.isPending}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {book.outputPath ? "Re-assemble" : "Assemble"} selected ({selectedWithAudio})
            </button>
          ) : null}
          {isProcessing ? (
            <button
              onClick={() => cancelMutation.mutate({ id: book.id })}
              disabled={cancelMutation.isPending}
              className="px-4 py-2 bg-zinc-600 text-white rounded-md text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          {book.chapters.length > 0 && !isProcessing ? (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-(--text-muted)" title="Only needed for scanned PDFs without selectable text">
                <input
                  type="checkbox"
                  checked={reExtractForceOcr ?? book.forceOcr}
                  onChange={(e) => setReExtractForceOcr(e.target.checked)}
                  className="rounded"
                />
                Force OCR
              </label>
              <label className="flex items-center gap-1.5 text-xs text-(--text-muted)" title="Uses a local LLM to identify chapter boundaries from the table of contents">
                <input
                  type="checkbox"
                  checked={reExtractLlm ?? book.llmChapterDetection}
                  onChange={(e) => setReExtractLlm(e.target.checked)}
                  className="rounded"
                />
                LLM chapters
              </label>
              <button
                onClick={() => {
                  if (confirm("This will delete all chapters and re-extract from the PDF. Continue?")) {
                    retryMutation.mutate({
                      id: book.id,
                      forceOcr: reExtractForceOcr ?? book.forceOcr,
                      llmChapterDetection: reExtractLlm ?? book.llmChapterDetection,
                    });
                    setReExtractForceOcr(null);
                    setReExtractLlm(null);
                  }
                }}
                disabled={retryMutation.isPending}
                className="px-4 py-2 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-sm font-medium hover:bg-(--border) disabled:opacity-50"
              >
                Re-extract the book
              </button>
              <button
                onClick={() => {
                  if (confirm("This will delete all chapter audio and re-detect chapter boundaries from existing extraction output. Continue?")) {
                    redetectMutation.mutate({
                      id: book.id,
                      forceOcr: reExtractForceOcr ?? book.forceOcr,
                      llmChapterDetection: reExtractLlm ?? book.llmChapterDetection,
                    });
                    setReExtractForceOcr(null);
                    setReExtractLlm(null);
                  }
                }}
                disabled={redetectMutation.isPending}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Re-detect chapters
              </button>
            </div>
          ) : null}
          <button
            onClick={() => {
              if (confirm("Delete this book and all its audio?")) {
                deleteMutation.mutate({ id: book.id });
              }
            }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            Delete
          </button>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-(--text-secondary)">Chapters</h2>
          {book.chapters.length > 0 ? (
            <span className="text-sm text-(--text-muted)">
              {selectedCount} of {book.chapters.length} selected
            </span>
          ) : null}
        </div>

        {book.chapters.length === 0 ? (
          <p className="text-(--text-muted) text-sm">
            {book.status === "extracting"
              ? "Extracting chapters from PDF..."
              : "No chapters extracted yet."}
          </p>
        ) : (
          <ChapterTable
            bookId={book.id}
            chapters={book.chapters}
            onQueue={(id) => queueMutation.mutate({ id })}
            onSuspend={(id) => suspendMutation.mutate({ id })}
            onSetSelected={(id, selected) => setSelectedMutation.mutate({ id, selected })}
            onSetAllSelected={(selected) => setAllSelectedMutation.mutate({ bookId: book.id, selected })}
            onSetSelectedBatch={(ids, selected) => setSelectedBatchMutation.mutate({ ids, selected })}
          />
        )}

        {bookAssemblies.length > 0 && (
          <AssembliesSection
            assemblies={bookAssemblies}
            latestOutputPath={book.outputPath}
            onDelete={(id) => deleteAssemblyMutation.mutate({ id })}
            isDeleting={deleteAssemblyMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

type AssemblyRow = {
  id: string;
  outputPath: string;
  durationMs: number;
  chapterCount: number;
  chapterSummary: string;
  createdAt: string | Date;
};

function AssembliesSection({
  assemblies,
  latestOutputPath,
  onDelete,
  isDeleting,
}: {
  assemblies: AssemblyRow[];
  latestOutputPath: string | null;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-(--text-secondary) mb-3">Assemblies</h2>
      <div className="overflow-hidden rounded-lg border border-(--border)">
        <table className="min-w-full divide-y divide-(--divide)">
          <thead className="bg-(--bg-subtle)">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Chapters</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
            {assemblies.map((assembly) => {
              const isLatest = assembly.outputPath === latestOutputPath;
              return (
                <tr key={assembly.id} className="hover:bg-(--bg-card-hover)">
                  <td className="px-4 py-3 text-sm text-(--text-secondary)">
                    <div className="flex items-center gap-2">
                      {formatAssemblyDate(assembly.createdAt)}
                      {isLatest && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                          latest
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-(--text-tertiary)">
                    <span title={assembly.chapterSummary}>
                      {assembly.chapterCount} chapter{assembly.chapterCount !== 1 ? "s" : ""}
                      <span className="text-(--text-faint) ml-1.5">{assembly.chapterSummary}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-(--text-tertiary) text-right tabular-nums">
                    {formatDuration(assembly.durationMs)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <a
                        href={`/download/assembly/${assembly.id}`}
                        className="text-xs text-green-600 hover:text-green-800 font-medium"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => {
                          if (confirm("Delete this assembly?")) {
                            onDelete(assembly.id);
                          }
                        }}
                        disabled={isDeleting}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatAssemblyDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type ProgressSectionProps = {
  status: string;
  doneChapters: number;
  totalChapters: number;
  chapters: { status: string; wordCount: number }[];
};

function ProgressSection({ status, doneChapters, totalChapters, chapters }: ProgressSectionProps) {
  const normalizingCount = chapters.filter((c) => c.status === "normalizing").length;
  const synthesizingCount = chapters.filter((c) => c.status === "synthesizing").length;
  const pendingCount = chapters.filter((c) => c.status === "pending").length;
  const suspendedCount = chapters.filter((c) => c.status === "suspended").length;

  const percent = totalChapters > 0 ? (doneChapters / totalChapters) * 100 : 0;

  let progressColor = "bg-blue-600";
  if (status === "assembling") progressColor = "bg-indigo-600";
  if (status === "extracting") progressColor = "bg-yellow-500";

  return (
    <div className="mb-6 bg-(--bg-card) border border-(--border) rounded-lg p-4">
      <div className="flex justify-between text-sm text-(--text-tertiary) mb-2">
        <span className="font-medium">
          {status === "extracting" && "Extracting text from PDF..."}
          {status === "normalizing" && "Normalizing text..."}
          {status === "synthesizing" && "Generating audio..."}
          {status === "assembling" && "Assembling final MP3..."}
        </span>
        {status === "synthesizing" && (
          <span className="tabular-nums">{doneChapters}/{totalChapters} chapters</span>
        )}
      </div>

      <div className="w-full bg-(--bg-page) rounded-full h-2.5 mb-3">
        <div
          className={`${progressColor} h-2.5 rounded-full transition-all duration-700 ease-out`}
          style={{
            width:
              status === "extracting"
                ? "15%"
                : status === "assembling"
                  ? "95%"
                  : `${Math.max(percent, 5)}%`,
          }}
        />
      </div>

      {status === "synthesizing" && totalChapters > 1 && (
        <div className="flex gap-4 text-xs text-(--text-muted)">
          {synthesizingCount > 0 && (
            <span>{synthesizingCount} synthesizing</span>
          )}
          {normalizingCount > 0 && (
            <span>{normalizingCount} normalizing</span>
          )}
          {pendingCount > 0 && (
            <span>{pendingCount} queued</span>
          )}
          {suspendedCount > 0 && (
            <span className="text-amber-600">{suspendedCount} suspended</span>
          )}
          {doneChapters > 0 && (
            <span className="text-green-600">{doneChapters} done</span>
          )}
        </div>
      )}
    </div>
  );
}

type StatsBarProps = {
  status: string;
  totalChapters: number;
  totalWords: number;
  totalDurationMs: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function StatsBar({ status, totalChapters, totalWords, totalDurationMs, createdAt, updatedAt }: StatsBarProps) {
  const isProcessing = !["done", "failed", "pending", "suspended"].includes(status);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <StatCard label="Chapters" value={totalChapters > 0 ? String(totalChapters) : "\u2014"} />
      <StatCard label="Words" value={totalWords > 0 ? totalWords.toLocaleString() : "\u2014"} />
      <StatCard
        label="Duration"
        value={totalDurationMs > 0 ? formatDuration(totalDurationMs) : "\u2014"}
      />
      <ElapsedCard
        isProcessing={isProcessing}
        createdAt={createdAt}
        updatedAt={updatedAt}
        status={status}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-(--bg-card) border border-(--border) rounded-lg px-4 py-3">
      <p className="text-xs text-(--text-muted) uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-(--text-primary) tabular-nums">{value}</p>
    </div>
  );
}

function ElapsedCard({
  isProcessing,
  createdAt,
  updatedAt,
  status,
}: {
  isProcessing: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  status: string;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isProcessing]);

  const start = new Date(createdAt).getTime();
  const end = isProcessing ? now : new Date(updatedAt).getTime();
  const elapsed = Math.max(0, end - start);

  const label = isProcessing ? "Elapsed" : status === "done" ? "Completed in" : "Time";

  return (
    <div className="bg-(--bg-card) border border-(--border) rounded-lg px-4 py-3">
      <p className="text-xs text-(--text-muted) uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-(--text-primary) tabular-nums">
        {formatElapsed(elapsed)}
      </p>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function LogViewer({ bookId, bookStatus }: { bookId: string; bookStatus: string }) {
  const isProcessing = !["done", "failed", "pending", "suspended"].includes(bookStatus);
  const [expanded, setExpanded] = useState(isProcessing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const utils = trpc.useUtils();

  const { data: logs = [] } = trpc.books.logs.useQuery(
    { bookId },
    { refetchInterval: isProcessing ? 1000 : false }
  );

  const clearLogs = trpc.books.clearLogs.useMutation({
    onSuccess: () => utils.books.logs.invalidate({ bookId }),
  });

  useEffect(() => {
    if (isProcessing && !expanded) setExpanded(true);
  }, [isProcessing]);

  useEffect(() => {
    if (!shouldAutoScroll.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  }

  if (logs.length === 0 && !isProcessing) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-(--text-tertiary) hover:text-(--text-primary)"
        >
          <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
          Logs ({logs.length})
        </button>
        {logs.length > 0 && (
          <button
            onClick={() => clearLogs.mutate({ bookId })}
            className="text-xs text-(--text-faint) hover:text-red-500"
          >
            Clear
          </button>
        )}
      </div>
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-(--bg-terminal) rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs leading-5"
        >
          {logs.length === 0 ? (
            <p className="text-zinc-500">Waiting for logs...</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <span className="text-zinc-500 shrink-0 select-none">
                  {formatLogTime(String(entry.createdAt))}
                </span>
                <span className="text-zinc-200 whitespace-pre-wrap break-all">
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatLogTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
