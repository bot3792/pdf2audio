import { useState, useEffect, useRef } from "react";
import { StatusBadge } from "./StatusBadge.tsx";
import { ChapterModal } from "./ChapterModal.tsx";

export type ChapterRow = {
  id: string;
  index: number;
  title: string;
  status: string;
  error: string | null;
  wordCount: number;
  durationMs: number | null;
  audioPath: string | null;
  hasCleanText: boolean;
  hasCustomText: boolean;
  hasSourceBlocks: boolean;
  progress: string | null;
  selected: boolean;
  pageStart: number | null;
  pageEnd: number | null;
};

const STATUSES = ["done", "failed", "pending", "suspended", "synthesizing", "normalizing"] as const;

export function ChapterTable({
  bookId,
  chapters,
  onQueue,
  onSuspend,
  onSetSelected,
  onSetAllSelected,
  onSetSelectedBatch,
}: {
  bookId: string;
  chapters: ChapterRow[];
  onQueue: (id: string) => void;
  onSuspend: (id: string) => void;
  onSetSelected: (id: string, selected: boolean) => void;
  onSetAllSelected: (selected: boolean) => void;
  onSetSelectedBatch: (ids: string[], selected: boolean) => void;
}) {
  const [modalChapterIndex, setModalChapterIndex] = useState<number | null>(null);
  const toggleAllRef = useRef<HTMLInputElement>(null);
  const lastClickedFilteredIndex = useRef<number | null>(null);
  const [playingChapterId, setPlayingChapterId] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Filter state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [statusOperator, setStatusOperator] = useState<"is" | "is_not">("is");
  const [wordCountMin, setWordCountMin] = useState("");
  const [wordCountMax, setWordCountMax] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [durationMax, setDurationMax] = useState("");
  const [durationUnit, setDurationUnit] = useState<"sec" | "min">("sec");

  // Derived: filtered chapters (no useMemo — simple filter, React Compiler handles it)
  const filteredChapters = chapters.filter((ch) => {
    if (search && !ch.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter) {
      if (statusOperator === "is" && ch.status !== statusFilter) return false;
      if (statusOperator === "is_not" && ch.status === statusFilter) return false;
    }
    const minW = Number(wordCountMin);
    if (minW && ch.wordCount < minW) return false;
    const maxW = Number(wordCountMax);
    if (maxW && ch.wordCount > maxW) return false;
    const durationMultiplier = durationUnit === "min" ? 60000 : 1000;
    const minD = Number(durationMin) * durationMultiplier;
    if (minD && (ch.durationMs ?? 0) < minD) return false;
    const maxD = Number(durationMax) * durationMultiplier;
    if (maxD && (ch.durationMs ?? 0) > maxD) return false;
    return true;
  });

  const isFiltered = filteredChapters.length !== chapters.length;
  const activeFilterCount = [search, statusFilter, wordCountMin, wordCountMax, durationMin, durationMax].filter(Boolean).length;

  // Checkbox state based on visible (filtered) chapters
  const visibleSelectedCount = filteredChapters.filter((c) => c.selected).length;
  const allVisibleSelected = filteredChapters.length > 0 && visibleSelectedCount === filteredChapters.length;
  const noneVisibleSelected = visibleSelectedCount === 0;

  useEffect(() => {
    if (toggleAllRef.current) {
      toggleAllRef.current.indeterminate = !allVisibleSelected && !noneVisibleSelected;
    }
  }, [allVisibleSelected, noneVisibleSelected]);

  function handleToggleAll() {
    if (isFiltered) {
      onSetSelectedBatch(filteredChapters.map((c) => c.id), !allVisibleSelected);
    } else {
      onSetAllSelected(!allVisibleSelected);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setStatusOperator("is");
    setWordCountMin("");
    setWordCountMax("");
    setDurationMin("");
    setDurationMax("");
    setDurationUnit("sec");
  }

  const playingChapter = playingChapterId
    ? chapters.find((c) => c.id === playingChapterId) ?? null
    : null;

  function handlePlay(chapterId: string) {
    if (playingChapterId === chapterId) {
      if (audioRef.current?.paused) {
        audioRef.current.play();
      } else {
        audioRef.current?.pause();
      }
      return;
    }
    setPlayingChapterId(chapterId);
  }

  function handleStopPlayer() {
    audioRef.current?.pause();
    setPlayingChapterId(null);
    setIsAudioPlaying(false);
  }

  // Autoplay when switching chapters
  useEffect(() => {
    if (playingChapterId && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [playingChapterId]);

  return (
    <>
      {/* Filter toggle + panel */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-(--text-tertiary) hover:text-(--text-primary)"
          >
            <span className={`text-xs transition-transform ${filtersOpen ? "rotate-90" : ""}`}>&#9654;</span>
            Filter
            {activeFilterCount > 0 && !filtersOpen ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          {activeFilterCount > 0 ? (
            <button
              onClick={clearFilters}
              className="text-xs text-(--text-faint) hover:text-(--text-tertiary)"
            >
              Clear
            </button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="bg-(--bg-card) border border-(--border) rounded-lg p-4 mb-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="flex items-center gap-3">
                <span className="text-xs font-medium text-(--text-muted) w-16 shrink-0">Search</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by title..."
                  className="w-full px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </label>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-(--text-muted) w-16 shrink-0">Status</span>
                <div className="flex items-center gap-2 flex-1">
                  <select
                    value={statusOperator}
                    onChange={(e) => setStatusOperator(e.target.value as "is" | "is_not")}
                    className="px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="is">is</option>
                    <option value="is_not">is not</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">All</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-(--text-muted) w-16 shrink-0">Words</span>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={wordCountMin}
                    onChange={(e) => setWordCountMin(e.target.value)}
                    placeholder="min"
                    min={0}
                    className="w-full px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 tabular-nums"
                  />
                  <span className="text-(--text-faint) text-xs">–</span>
                  <input
                    type="number"
                    value={wordCountMax}
                    onChange={(e) => setWordCountMax(e.target.value)}
                    placeholder="max"
                    min={0}
                    className="w-full px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 tabular-nums"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-(--text-muted) w-16 shrink-0">Duration</span>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    placeholder="min"
                    min={0}
                    className="w-full px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 tabular-nums"
                  />
                  <span className="text-(--text-faint) text-xs">–</span>
                  <input
                    type="number"
                    value={durationMax}
                    onChange={(e) => setDurationMax(e.target.value)}
                    placeholder="max"
                    min={0}
                    className="w-full px-2.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 tabular-nums"
                  />
                  <select
                    value={durationUnit}
                    onChange={(e) => setDurationUnit(e.target.value as "sec" | "min")}
                    className="px-1.5 py-1.5 text-sm border border-(--border-input) rounded-md bg-(--bg-input) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 shrink-0"
                  >
                    <option value="sec">sec</option>
                    <option value="min">min</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Filter summary + bulk actions */}
        {isFiltered ? (
          <div className="flex items-center justify-between text-xs text-(--text-muted) mb-2">
            <span>
              Showing {filteredChapters.length} of {chapters.length} chapters
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onSetSelectedBatch(filteredChapters.map((c) => c.id), true)}
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Select filtered
              </button>
              <button
                onClick={() => onSetSelectedBatch(filteredChapters.map((c) => c.id), false)}
                className="text-(--text-muted) hover:text-(--text-secondary) font-medium"
              >
                Deselect filtered
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-(--border)">
        <table className="min-w-full divide-y divide-(--divide)">
          <thead className="bg-(--bg-subtle)">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  ref={toggleAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={handleToggleAll}
                  className="rounded border-(--border-input) text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider w-40">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Words</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
            {filteredChapters.map((chapter) => {
              const isActive = chapter.status === "synthesizing" || chapter.status === "normalizing";
              const canQueue = !isActive && chapter.status !== "done" && chapter.status !== "pending";
              const canSuspend = chapter.status === "pending";

              return (
                <tr
                  key={chapter.id}
                  className={`hover:bg-(--bg-card-hover) ${!chapter.selected ? "opacity-40" : ""}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={chapter.selected}
                      onChange={() => {}}
                      onClick={(e) => {
                        const filteredIdx = filteredChapters.indexOf(chapter);
                        const newValue = !chapter.selected;
                        if (e.shiftKey && lastClickedFilteredIndex.current !== null) {
                          const from = Math.min(lastClickedFilteredIndex.current, filteredIdx);
                          const to = Math.max(lastClickedFilteredIndex.current, filteredIdx);
                          const ids = filteredChapters.slice(from, to + 1).map((c) => c.id);
                          onSetSelectedBatch(ids, newValue);
                        } else {
                          onSetSelected(chapter.id, newValue);
                        }
                        lastClickedFilteredIndex.current = filteredIdx;
                      }}
                      className="rounded border-(--border-input) text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-(--text-tertiary)">{chapter.index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModalChapterIndex(chapters.indexOf(chapter))}
                        className="text-sm font-medium text-(--text-primary) hover:text-blue-700 text-left"
                      >
                        {chapter.title}
                      </button>
                      {chapter.hasCustomText ? (
                        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-600">
                          edited
                        </span>
                      ) : null}
                      {chapter.pageStart ? (
                        <span className="text-xs text-(--text-faint) tabular-nums">
                          p.{chapter.pageStart}{chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ChapterStatusCell chapter={chapter} />
                  </td>
                  <td className="px-4 py-3 text-sm text-(--text-tertiary) text-right tabular-nums">
                    {chapter.wordCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-(--text-tertiary) text-right tabular-nums">
                    {chapter.durationMs ? formatDuration(chapter.durationMs) : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {chapter.status === "done" && chapter.audioPath ? (
                        <button
                          onClick={() => handlePlay(chapter.id)}
                          className={`w-6 h-6 flex items-center justify-center rounded text-sm ${
                            playingChapterId === chapter.id
                              ? "text-indigo-600 hover:text-indigo-800"
                              : "text-(--text-faint) hover:text-(--text-secondary)"
                          }`}
                          title={playingChapterId === chapter.id && isAudioPlaying ? "Pause" : "Play"}
                        >
                          {playingChapterId === chapter.id && isAudioPlaying ? "\u23F8" : "\u25B6"}
                        </button>
                      ) : null}
                      {chapter.hasSourceBlocks ? (
                        <a
                          href={`/read/chapter/${chapter.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          title="Open reader view in a new tab"
                        >
                          Read
                        </a>
                      ) : null}
                      {canQueue ? (
                        <button
                          onClick={() => onQueue(chapter.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Queue
                        </button>
                      ) : null}
                      {canSuspend ? (
                        <button
                          onClick={() => onSuspend(chapter.id)}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                        >
                          Suspend
                        </button>
                      ) : null}
                      {chapter.status === "done" ? (
                        <button
                          onClick={() => onQueue(chapter.id)}
                          className="text-xs text-(--text-faint) hover:text-(--text-tertiary) font-medium"
                          title="Re-synthesize this chapter"
                        >
                          Redo
                        </button>
                      ) : null}
                      {chapter.error ? (
                        <span className="text-xs text-red-500" title={chapter.error}>
                          error
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredChapters.length === 0 && chapters.length > 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-(--text-faint)">
                  No chapters match the current filters
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {playingChapter ? (
        <div className="sticky bottom-4 mt-3 bg-(--bg-card) border border-(--border) rounded-lg px-4 py-3 flex items-center gap-4 shadow-lg z-10">
          <button
            onClick={() => handlePlay(playingChapter.id)}
            className="text-lg text-indigo-600 hover:text-indigo-800 w-8 h-8 flex items-center justify-center shrink-0"
          >
            {isAudioPlaying ? "\u23F8" : "\u25B6"}
          </button>
          <div className="text-sm text-(--text-secondary) font-medium truncate min-w-0 shrink-0 max-w-48">
            Ch {playingChapter.index + 1} &mdash; {playingChapter.title}
          </div>
          <audio
            ref={audioRef}
            src={`/audio/chapter/${playingChapterId}`}
            onPlay={() => setIsAudioPlaying(true)}
            onPause={() => setIsAudioPlaying(false)}
            onEnded={() => { setPlayingChapterId(null); setIsAudioPlaying(false); }}
            controls
            className="flex-1 h-8 min-w-0"
          />
          <button
            onClick={handleStopPlayer}
            className="text-xs text-(--text-faint) hover:text-(--text-tertiary) shrink-0"
            title="Close player"
          >
            &#10005;
          </button>
        </div>
      ) : null}

      {modalChapterIndex !== null ? (
        <ChapterModal
          chapters={chapters}
          chapterIndex={modalChapterIndex}
          onClose={() => setModalChapterIndex(null)}
          onNavigate={setModalChapterIndex}
          onQueue={onQueue}
          onSuspend={onSuspend}
          onSetSelected={onSetSelected}
        />
      ) : null}
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
          <span className="text-[10px] text-(--text-muted) tabular-nums">{chapter.progress}</span>
        </div>
        <div className="w-full bg-(--bg-page) rounded-full h-1">
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
