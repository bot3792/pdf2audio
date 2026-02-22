import { useState, useRef, useEffect } from "react";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import type { ChapterRow } from "./ChapterTable.tsx";

type ChapterModalProps = {
  chapters: ChapterRow[];
  chapterIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onQueue: (id: string) => void;
  onSuspend: (id: string) => void;
};

type ViewMode = "custom" | "clean" | "raw" | "split";

export function ChapterModal({
  chapters,
  chapterIndex,
  onClose,
  onNavigate,
  onQueue,
  onSuspend,
}: ChapterModalProps) {
  const chapter = chapters[chapterIndex];
  const hasPrev = chapterIndex > 0;
  const hasNext = chapterIndex < chapters.length - 1;

  const defaultViewMode: ViewMode = chapter.hasCustomText ? "custom" : chapter.hasCleanText ? "clean" : "raw";
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const { data: fullChapter, isLoading } = trpc.chapters.get.useQuery({ id: chapter.id });
  const utils = trpc.useUtils();

  const updateTextMutation = trpc.chapters.updateText.useMutation({
    onSuccess: () => {
      utils.chapters.get.invalidate({ id: chapter.id });
      utils.books.get.invalidate();
      setIsEditing(false);
    },
  });

  const resetTextMutation = trpc.chapters.resetText.useMutation({
    onSuccess: () => {
      utils.chapters.get.invalidate({ id: chapter.id });
      utils.books.get.invalidate();
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (isEditing) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(chapterIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(chapterIndex + 1);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isEditing, hasPrev, hasNext, chapterIndex, onNavigate]);

  function startEditing() {
    if (!fullChapter) return;
    setEditText(fullChapter.customText ?? fullChapter.cleanText ?? fullChapter.rawText);
    setIsEditing(true);
  }

  function handleSave() {
    if (!editText.trim()) return;
    updateTextMutation.mutate({ id: chapter.id, customText: editText });
  }

  function handleReset() {
    if (!confirm("Reset to original text? Your edits will be lost.")) return;
    resetTextMutation.mutate({ id: chapter.id });
  }

  const isActive = chapter.status === "synthesizing" || chapter.status === "normalizing";
  const canQueue = !isActive && chapter.status !== "done" && chapter.status !== "pending";
  const canSuspend = chapter.status === "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-zinc-200">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => hasPrev && onNavigate(chapterIndex - 1)}
              disabled={!hasPrev}
              className="shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 disabled:cursor-default"
              title="Previous chapter"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => hasNext && onNavigate(chapterIndex + 1)}
              disabled={!hasNext}
              className="shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 disabled:cursor-default"
              title="Next chapter"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
            <div className="min-w-0 ml-1">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-sm font-mono text-zinc-400">#{chapter.index + 1}</span>
                <h2 className="text-lg font-semibold text-zinc-900 truncate">{chapter.title}</h2>
                <StatusBadge status={chapter.status} error={chapter.error} />
                {chapter.hasCustomText ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                    edited
                  </span>
                ) : null}
              </div>
              <div className="flex gap-4 text-xs text-zinc-500">
                <span>{chapter.wordCount.toLocaleString()} words</span>
                {chapter.durationMs ? (
                  <span>{formatDuration(chapter.durationMs)}</span>
                ) : null}
                {chapter.progress && chapter.status === "synthesizing" ? (
                  <span className="text-blue-600 font-medium">Chunk {chapter.progress}</span>
                ) : null}
              </div>
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
          {chapter.status === "done" && chapter.audioPath ? (
            <audio controls preload="none" className="h-8 mr-2">
              <source src={`/audio/chapter/${chapter.id}`} type="audio/mpeg" />
            </audio>
          ) : null}
          {canQueue ? (
            <button
              onClick={() => onQueue(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
            >
              Queue
            </button>
          ) : null}
          {canSuspend ? (
            <button
              onClick={() => onSuspend(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium"
            >
              Suspend
            </button>
          ) : null}
          {chapter.status === "done" ? (
            <button
              onClick={() => onQueue(chapter.id)}
              className="text-xs px-2.5 py-1 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 font-medium"
            >
              Re-synthesize
            </button>
          ) : null}
          <div className="flex-1" />
          {isEditing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={updateTextMutation.isPending}
                className="text-xs px-2.5 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-medium disabled:opacity-50"
              >
                {updateTextMutation.isPending ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs px-2.5 py-1 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {chapter.hasCustomText ? (
                <button
                  onClick={handleReset}
                  disabled={resetTextMutation.isPending}
                  className="text-xs px-2.5 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium disabled:opacity-50"
                >
                  Reset
                </button>
              ) : null}
              {fullChapter ? (
                <button
                  onClick={startEditing}
                  className="text-xs px-2.5 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium"
                >
                  Edit
                </button>
              ) : null}
              <ViewModeTabs
                viewMode={viewMode}
                onSetViewMode={setViewMode}
                hasCleanText={chapter.hasCleanText}
                hasCustomText={chapter.hasCustomText}
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col p-5">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-sm text-zinc-400">
              Loading text...
            </div>
          ) : fullChapter ? (
            isEditing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="flex-1 min-h-0 rounded bg-white border border-amber-300 p-4 font-mono text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            ) : (
              <TextPreview
                rawText={fullChapter.rawText}
                cleanText={fullChapter.cleanText}
                customText={fullChapter.customText}
                viewMode={viewMode}
              />
            )
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

function ViewModeTabs({
  viewMode,
  onSetViewMode,
  hasCleanText,
  hasCustomText,
}: {
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  hasCleanText: boolean;
  hasCustomText: boolean;
}) {
  const modes: ViewMode[] = [];
  if (hasCustomText) modes.push("custom");
  if (hasCleanText) modes.push("clean");
  modes.push("raw");
  if (hasCleanText) modes.push("split");

  if (modes.length <= 1) return null;

  return (
    <div className="flex rounded-md border border-zinc-200 overflow-hidden text-xs">
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onSetViewMode(mode)}
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
  );
}

function TextPreview({
  rawText,
  cleanText,
  customText,
  viewMode,
}: {
  rawText: string;
  cleanText: string | null;
  customText: string | null;
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

  if (viewMode === "custom" && customText) {
    return (
      <div className={textClass + " border-amber-200 bg-amber-50/30"}>
        {customText}
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
