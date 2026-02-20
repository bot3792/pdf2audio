import { useState, useRef, useEffect } from "react";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";

type ChapterSummary = {
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

type ChapterModalProps = {
  chapter: ChapterSummary;
  onClose: () => void;
  onQueue: (id: string) => void;
  onSuspend: (id: string) => void;
};

type ViewMode = "clean" | "raw" | "split";

export function ChapterModal({ chapter, onClose, onQueue, onSuspend }: ChapterModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(chapter.hasCleanText ? "clean" : "raw");
  const { data: fullChapter, isLoading } = trpc.chapters.get.useQuery({ id: chapter.id });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const isActive = chapter.status === "synthesizing" || chapter.status === "normalizing";
  const canQueue = !isActive && chapter.status !== "done" && chapter.status !== "pending";
  const canSuspend = chapter.status === "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-zinc-200">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-mono text-zinc-400">#{chapter.index + 1}</span>
              <h2 className="text-lg font-semibold text-zinc-900 truncate">{chapter.title}</h2>
              <StatusBadge status={chapter.status} error={chapter.error} />
            </div>
            <div className="flex gap-4 text-xs text-zinc-500">
              <span>{chapter.wordCount.toLocaleString()} words</span>
              {chapter.durationMs && (
                <span>{formatDuration(chapter.durationMs)}</span>
              )}
              {chapter.progress && chapter.status === "synthesizing" && (
                <span className="text-blue-600 font-medium">Chunk {chapter.progress}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-zinc-400 hover:text-zinc-600 rounded"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-100 bg-zinc-50">
          {chapter.status === "done" && chapter.audioPath && (
            <audio controls preload="none" className="h-8 mr-2">
              <source src={`/audio/chapter/${chapter.id}`} type="audio/mpeg" />
            </audio>
          )}
          {canQueue && (
            <button
              onClick={() => onQueue(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
            >
              Queue
            </button>
          )}
          {canSuspend && (
            <button
              onClick={() => onSuspend(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium"
            >
              Suspend
            </button>
          )}
          {chapter.status === "done" && (
            <button
              onClick={() => onQueue(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 font-medium"
            >
              Re-synthesize
            </button>
          )}
          <div className="flex-1" />
          {chapter.hasCleanText && (
            <div className="flex rounded-md border border-zinc-200 overflow-hidden text-xs">
              {(["clean", "raw", "split"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1 capitalize ${
                    viewMode === mode
                      ? "bg-zinc-800 text-white"
                      : "bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col p-5">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-sm text-zinc-400">
              Loading text...
            </div>
          ) : fullChapter ? (
            <TextPreview
              rawText={fullChapter.rawText}
              cleanText={fullChapter.cleanText}
              viewMode={viewMode}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 text-sm text-red-400">
              Failed to load chapter text
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TextPreview({
  rawText,
  cleanText,
  viewMode,
}: {
  rawText: string;
  cleanText: string | null;
  viewMode: ViewMode;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  function handleScroll(source: "left" | "right") {
    if (syncing.current) return;
    syncing.current = true;

    const from = source === "left" ? leftRef.current : rightRef.current;
    const to = source === "left" ? rightRef.current : leftRef.current;
    if (from && to) {
      const ratio = from.scrollTop / (from.scrollHeight - from.clientHeight || 1);
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight || 1);
    }

    requestAnimationFrame(() => { syncing.current = false; });
  }

  const textClass = "flex-1 min-h-0 overflow-y-auto rounded bg-zinc-50 border border-zinc-200 p-4 font-mono text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed";

  if (viewMode === "split" && cleanText) {
    return (
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 font-medium shrink-0">Raw</span>
          <div
            ref={leftRef}
            onScroll={() => handleScroll("left")}
            className={textClass}
          >
            {rawText}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 font-medium shrink-0">Clean</span>
          <div
            ref={rightRef}
            onScroll={() => handleScroll("right")}
            className={textClass}
          >
            {cleanText}
          </div>
        </div>
      </div>
    );
  }

  const text = viewMode === "clean" && cleanText ? cleanText : rawText;

  return (
    <div className={textClass}>
      {text}
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
