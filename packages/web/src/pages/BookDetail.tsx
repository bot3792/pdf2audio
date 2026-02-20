import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { PipelineSteps } from "../components/PipelineSteps.tsx";
import { ChapterModal } from "../components/ChapterModal.tsx";

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

  const invalidate = () => utils.books.get.invalidate({ id: id! });

  const cancelMutation = trpc.books.cancel.useMutation({ onSuccess: invalidate });
  const retryMutation = trpc.books.retry.useMutation({ onSuccess: invalidate });
  const resumeMutation = trpc.books.resume.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.books.delete.useMutation({
    onSuccess: () => window.location.assign("/"),
  });
  const queueMutation = trpc.chapters.queue.useMutation({ onSuccess: invalidate });
  const suspendMutation = trpc.chapters.suspend.useMutation({ onSuccess: invalidate });

  if (isLoading || !book) {
    return (
      <div className="min-h-screen bg-zinc-100">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  const doneChapters = book.chapters.filter((c) => c.status === "done").length;
  const isProcessing = ["extracting", "synthesizing", "assembling", "normalizing"].includes(book.status);
  const isStopped = book.status === "failed" || book.status === "suspended";

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block">
          &larr; Back
        </Link>

        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{book.title}</h1>
            <p className="text-sm text-zinc-500 mt-1">
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
          {book.status === "done" && book.outputPath && (
            <a
              href={`/download/${book.id}`}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
            >
              Download MP3
            </a>
          )}
          {isProcessing && (
            <button
              onClick={() => cancelMutation.mutate({ id: book.id })}
              disabled={cancelMutation.isPending}
              className="px-4 py-2 bg-zinc-600 text-white rounded-md text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {isStopped && (
            <>
              <button
                onClick={() => resumeMutation.mutate({ id: book.id })}
                disabled={resumeMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {book.chapters.length > 0 ? "Resume All" : "Retry"}
              </button>
              {book.chapters.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm("This will delete all chapters and start from scratch. Continue?")) {
                      retryMutation.mutate({ id: book.id });
                    }
                  }}
                  disabled={retryMutation.isPending}
                  className="px-4 py-2 bg-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-300 disabled:opacity-50"
                >
                  Re-extract
                </button>
              )}
            </>
          )}
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

        <h2 className="text-lg font-semibold text-zinc-800 mb-3">Chapters</h2>

        {book.chapters.length === 0 ? (
          <p className="text-zinc-500 text-sm">
            {book.status === "extracting"
              ? "Extracting chapters from PDF..."
              : "No chapters extracted yet."}
          </p>
        ) : (
          <ChapterTable
            chapters={book.chapters}
            onQueue={(id) => queueMutation.mutate({ id })}
            onSuspend={(id) => suspendMutation.mutate({ id })}
          />
        )}
      </div>
    </div>
  );
}

type ChapterRow = {
  id: string;
  index: number;
  title: string;
  status: string;
  error: string | null;
  wordCount: number;
  durationMs: number | null;
  audioPath: string | null;
  hasCleanText: boolean;
  progress: string | null;
};

function ChapterTable({
  chapters,
  onQueue,
  onSuspend,
}: {
  chapters: ChapterRow[];
  onQueue: (id: string) => void;
  onSuspend: (id: string) => void;
}) {
  const [modalChapter, setModalChapter] = useState<ChapterRow | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider w-40">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Words</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {chapters.map((chapter) => {
              const isActive = chapter.status === "synthesizing" || chapter.status === "normalizing";
              const canQueue = !isActive && chapter.status !== "done" && chapter.status !== "pending";
              const canSuspend = chapter.status === "pending";

              return (
                <tr key={chapter.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 text-sm text-zinc-600">{chapter.index + 1}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setModalChapter(chapter)}
                      className="text-sm font-medium text-zinc-900 hover:text-blue-700 text-left"
                    >
                      {chapter.title}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <ChapterStatusCell chapter={chapter} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 text-right tabular-nums">
                    {chapter.wordCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 text-right tabular-nums">
                    {chapter.durationMs ? formatDuration(chapter.durationMs) : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {chapter.status === "done" && chapter.audioPath && (
                        <audio controls preload="none" className="h-8">
                          <source src={`/audio/chapter/${chapter.id}`} type="audio/mpeg" />
                        </audio>
                      )}
                      {canQueue && (
                        <button
                          onClick={() => onQueue(chapter.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Queue
                        </button>
                      )}
                      {canSuspend && (
                        <button
                          onClick={() => onSuspend(chapter.id)}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                        >
                          Suspend
                        </button>
                      )}
                      {chapter.status === "done" && (
                        <button
                          onClick={() => onQueue(chapter.id)}
                          className="text-xs text-zinc-400 hover:text-zinc-600 font-medium"
                          title="Re-synthesize this chapter"
                        >
                          Redo
                        </button>
                      )}
                      {chapter.error && (
                        <span className="text-xs text-red-500" title={chapter.error}>
                          error
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modalChapter && (
        <ChapterModal
          chapter={modalChapter}
          onClose={() => setModalChapter(null)}
          onQueue={onQueue}
          onSuspend={onSuspend}
        />
      )}
    </>
  );
}

function ChapterStatusCell({ chapter }: { chapter: ChapterRow }) {
  if (chapter.status === "synthesizing" && chapter.progress) {
    const [current, total] = chapter.progress.split("/").map(Number);
    const percent = total > 0 ? (current / total) * 100 : 0;

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={chapter.status} />
          <span className="text-[10px] text-zinc-500 tabular-nums">{chapter.progress}</span>
        </div>
        <div className="w-full bg-zinc-100 rounded-full h-1">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return <StatusBadge status={chapter.status} error={chapter.error} />;
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
    <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex justify-between text-sm text-zinc-600 mb-2">
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

      <div className="w-full bg-zinc-100 rounded-full h-2.5 mb-3">
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
        <div className="flex gap-4 text-xs text-zinc-500">
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
    <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-zinc-900 tabular-nums">{value}</p>
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
    <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-zinc-900 tabular-nums">
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
  const [logs, setLogs] = useState<{ id: string; message: string; createdAt: string }[]>([]);
  const cursorRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const { data } = trpc.books.logs.useQuery(
    { bookId, after: cursorRef.current },
    { refetchInterval: isProcessing ? 1000 : false }
  );

  useEffect(() => {
    if (!data || data.length === 0) return;
    setLogs((prev) => {
      const existingIds = new Set(prev.map((l) => l.id));
      const newEntries = data
        .filter((l) => !existingIds.has(l.id))
        .map((l) => ({ id: l.id, message: l.message, createdAt: String(l.createdAt) }));
      if (newEntries.length === 0) return prev;
      return [...prev, ...newEntries];
    });
    const lastEntry = data[data.length - 1];
    cursorRef.current = String(lastEntry.createdAt);
  }, [data]);

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
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 mb-2"
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
        Logs ({logs.length})
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-zinc-900 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs leading-5"
        >
          {logs.length === 0 ? (
            <p className="text-zinc-500">Waiting for logs...</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <span className="text-zinc-500 shrink-0 select-none">
                  {formatLogTime(entry.createdAt)}
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
