import { useState, useRef, useEffect, type ReactNode } from "react";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { PdfPreviewModal } from "./PdfPreviewModal.tsx";
import { TranslationModal } from "./TranslationModal.tsx";
import { getVoiceLabel } from "../lib/voices.ts";
import type { ChapterRow, FileInfo } from "./ChapterTable.tsx";

type ChapterModalProps = {
  bookId: string;
  chapters: ChapterRow[];
  files?: FileInfo[];
  chapterIndex: number;
  // When set, the modal shows this language's translation: its text, chunk previews, and audio
  language?: string | null;
  languages?: string[];
  onSwitchLanguage?: (language: string | null) => void;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onQueue: (id: string, resume?: boolean) => void;
  onSetSelected: (id: string, selected: boolean) => void;
};

type SourceBlock = {
  type: string;
  text: string;
  page: number;
  included: boolean;
  level?: number;
  polygon?: number[][];
};

type ViewMode = "custom" | "clean" | "raw" | "split" | "blocks";

export function ChapterModal({
  bookId,
  chapters,
  files,
  chapterIndex,
  language,
  languages,
  onSwitchLanguage,
  onClose,
  onNavigate,
  onQueue,
  onSetSelected,
}: ChapterModalProps) {
  const chapter = chapters[chapterIndex];
  const hasPrev = chapterIndex > 0;
  const hasNext = chapterIndex < chapters.length - 1;

  const [viewMode, setViewMode] = useState<ViewMode>(chapter.hasCustomText ? "custom" : chapter.hasCleanText ? "clean" : "raw");
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [selectedChunkPreviewUrl, setSelectedChunkPreviewUrl] = useState<string | null>(null);
  // Bumped only on an explicit user selection (clicking a chunk button or its text) so the audio
  // auto-plays then — but NOT when a chunk is auto-selected programmatically during synthesis.
  const [playNonce, setPlayNonce] = useState(0);

  const selectChunk = (url: string) => {
    setSelectedChunkPreviewUrl(url);
    setPlayNonce((n) => n + 1);
  };

  // Shared so hovering a chunk button highlights its text span and vice versa.
  const [hoveredChunkUrl, setHoveredChunkUrl] = useState<string | null>(null);

  const [pdfPage, setPdfPage] = useState<number | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    setViewMode(chapter.hasCustomText ? "custom" : chapter.hasCleanText ? "clean" : "raw");
    setIsEditing(false);
    setSelectedChunkPreviewUrl(null);
    setPdfPage(null);
  }, [chapterIndex, language]);

  const isTranslation = !!language;
  const { data: originalChapter, isLoading: originalLoading } = trpc.chapters.get.useQuery(
    { id: chapter.id },
    { enabled: !isTranslation, refetchInterval: chapter.status === "synthesizing" ? 1000 : false },
  );
  const { data: translationDetail, isLoading: translationLoading } = trpc.translations.detail.useQuery(
    { chapterId: chapter.id, language: language! },
    {
      enabled: isTranslation,
      retry: false,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === "pending" || s === "translating" || chapter.status === "synthesizing" ? 1000 : false;
      },
    },
  );
  const fullChapter = isTranslation
    ? translationDetail && {
        rawText: translationDetail.text,
        cleanText: null,
        customText: null,
        sourceBlocks: null,
        chunkTextSource: "raw" as const,
        chunkPreviews: translationDetail.chunkPreviews,
      }
    : originalChapter;
  const isLoading = isTranslation ? translationLoading : originalLoading;
  const utils = trpc.useUtils();

  useEffect(() => {
    const previews = fullChapter?.chunkPreviews ?? [];
    if (previews.length === 0) {
      setSelectedChunkPreviewUrl(null);
      return;
    }

    // While synthesizing, follow the latest chunk; otherwise default to the first so playback
    // (and the play button) starts from the beginning of the chapter.
    const fallbackUrl = chapter.status === "synthesizing" ? previews.at(-1)!.url : previews[0].url;

    setSelectedChunkPreviewUrl((current) => {
      if (!current) return fallbackUrl;
      const exists = previews.some((preview) => preview.url === current);
      return exists ? current : fallbackUrl;
    });
  }, [fullChapter?.chunkPreviews, chapter.status]);

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

  const refreshTranslations = () => {
    utils.translations.detail.invalidate();
    utils.translations.listForBook.invalidate();
    utils.translations.languages.invalidate();
    utils.books.logs.invalidate();
  };
  const startTranslationMutation = trpc.translations.start.useMutation({ onSuccess: refreshTranslations });
  const stopTranslationMutation = trpc.translations.stop.useMutation({ onSuccess: refreshTranslations });

  const invalidateCleanup = () => {
    utils.books.get.invalidate();
    utils.chapters.get.invalidate({ id: chapter.id });
    utils.books.logs.invalidate();
  };
  const queueCleanupMutation = trpc.chapters.queueCleanup.useMutation({ onSuccess: invalidateCleanup });
  const stopCleanupMutation = trpc.chapters.stopCleanup.useMutation({ onSuccess: invalidateCleanup });

  const cleanupStatus = chapter.cleanup?.status;
  const cleanupRunning = cleanupStatus === "pending" || cleanupStatus === "cleaning";
  // books.get polling flips the status while this modal is open; the text itself lives in chapters.get
  const wasCleaningRef = useRef(false);
  useEffect(() => {
    if (wasCleaningRef.current && !cleanupRunning) {
      utils.chapters.get.invalidate({ id: chapter.id });
    }
    wasCleaningRef.current = cleanupRunning;
  }, [cleanupRunning, chapter.id]);
  const cleanupLabel =
    cleanupRunning ? "Cleaning..." :
    cleanupStatus === "failed" ? "Retry cleanup" :
    cleanupStatus === "done" ? "Re-clean" :
    "Cleanup (AI)";

  const translationStatus = isTranslation ? translationDetail?.status : undefined;
  const translationRunning = translationStatus === "pending" || translationStatus === "translating";
  const translateLabel =
    translationStatus === "suspended" ? "Resume" :
    translationStatus === "failed" ? "Retry" :
    translationStatus === "done" ? "Re-translate" :
    "Translate";

  function handleTranslate() {
    startTranslationMutation.mutate({
      chapterId: chapter.id,
      language: language!,
      restart: translationStatus === "done",
    });
  }

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // The compare overlay has its own Escape handler — this one must not double-close.
      if (isEditing || showCompare) return;
      if (e.key === "Escape") {
        if (pdfPage !== null) setPdfPage(null);
        else onClose();
      }
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(chapterIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(chapterIndex + 1);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isEditing, showCompare, hasPrev, hasNext, chapterIndex, onNavigate, pdfPage]);

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

  // Clickable chunk ranges for the text panel — only when the active view renders the same text
  // the chunk offsets point into (chunkTextSource). Selecting a span mirrors the chunk buttons.
  const activeChunkUrl = selectedChunkPreviewUrl ?? fullChapter?.chunkPreviews.at(-1)?.url ?? null;
  const sourceFile =
    files?.find((f) => f.index === chapter.sourceFileIndex) ?? (files?.length === 1 ? files[0] : undefined);
  const activeChunkPage = fullChapter?.chunkPreviews.find((p) => p.url === activeChunkUrl)?.page ?? null;
  const chunkRanges =
    fullChapter && viewMode === fullChapter.chunkTextSource
      ? fullChapter.chunkPreviews.flatMap((p) =>
          typeof p.start === "number" && typeof p.end === "number"
            ? [{ start: p.start, end: p.end, url: p.url }]
            : [],
        )
      : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {hasPrev ? (
        <a
          href="#prev"
          onClick={(e) => { e.preventDefault(); onNavigate(chapterIndex - 1); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-(--bg-card)/90 shadow-md border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-card) transition-colors text-xl font-light select-none no-underline"
          title="Previous chapter (←)"
        >
          &lt;
        </a>
      ) : null}
      {hasNext ? (
        <a
          href="#next"
          onClick={(e) => { e.preventDefault(); onNavigate(chapterIndex + 1); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-(--bg-card)/90 shadow-md border border-(--border) text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-card) transition-colors text-xl font-light select-none no-underline"
          title="Next chapter (→)"
        >
          &gt;
        </a>
      ) : null}
      <div className="relative bg-(--bg-card) rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-(--border)">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <input
                type="checkbox"
                checked={chapter.selected}
                onChange={() => onSetSelected(chapter.id, !chapter.selected)}
                className="rounded border-(--border-input) text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-mono text-(--text-faint)">#{chapter.index + 1}</span>
              <h2 className="text-lg font-semibold text-(--text-primary) truncate">{chapter.title}</h2>
              <StatusBadge status={chapter.status} error={chapter.error} />
              {!isTranslation && chapter.cleanup?.status === "done" ? (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700"
                  title="Cleaned by AI — the custom text holds the result"
                >
                  cleaned
                </span>
              ) : chapter.hasCustomText ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                  edited
                </span>
              ) : null}
            </div>
            <div className="flex gap-4 text-xs text-(--text-muted)">
              <span>{chapter.wordCount.toLocaleString()} words</span>
              {chapter.durationMs ? (
                <span>{formatDuration(chapter.durationMs)}</span>
              ) : null}
              {chapter.pageStart ? (
                sourceFile ? (
                  <button
                    onClick={() => setPdfPage(chapter.pageStart!)}
                    className="tabular-nums text-blue-600 hover:text-blue-800"
                    title="Open the source PDF at this chapter's first page"
                  >
                    p.{chapter.pageStart}{chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""}
                  </button>
                ) : (
                  <span className="tabular-nums">
                    p.{chapter.pageStart}{chapter.pageEnd && chapter.pageEnd !== chapter.pageStart ? `–${chapter.pageEnd}` : ""}
                  </span>
                )
              ) : null}
              {chapter.progress && chapter.status === "synthesizing" ? (
                <span className="text-blue-600 font-medium">Chunk {chapter.progress}</span>
              ) : null}
              {chapter.progress && chapter.status === "suspended" ? (
                <span className="text-(--text-muted) font-medium">{chapter.progress} synthesized</span>
              ) : null}
              {chapter.synthesizedWith?.voice ? (
                <span>{getVoiceLabel(chapter.synthesizedWith.voice)}</span>
              ) : null}
              {chapter.synthesizedWith?.speed !== null && chapter.synthesizedWith?.speed !== undefined ? (
                <span>{chapter.synthesizedWith.speed}x</span>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-(--text-faint) hover:text-(--text-tertiary) rounded"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-(--border) bg-(--bg-subtle)">
          {chapter.status === "done" && chapter.audioPath ? (
            <audio key={`${chapter.id}-${language ?? "original"}`} controls preload="none" className="h-8 mr-2">
              <source src={chapter.audioUrl ?? `/audio/chapter/${chapter.id}`} type="audio/mpeg" />
            </audio>
          ) : null}
          {chapter.status === "suspended" || chapter.status === "failed" ? (
            <button
              onClick={() => onQueue(chapter.id, true)}
              title="Continue synthesis from where it stopped — reuses already-synthesized chunks"
              className="text-xs px-2.5 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-medium"
            >
              Continue
            </button>
          ) : null}
          <button
            onClick={() => onQueue(chapter.id)}
            disabled={["pending", "normalizing", "synthesizing"].includes(chapter.status) || chapter.synthesizable === false}
            title={
              chapter.synthesizable === false
                ? "No finished translation for this chapter"
                : ["pending", "normalizing", "synthesizing"].includes(chapter.status)
                  ? "Can't re-synthesize while it's being processed"
                  : "Re-synthesize this chapter's audio from text (from scratch)"
            }
            className="text-xs px-2.5 py-1 rounded bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border) font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Re-synthesize
          </button>
          {!isTranslation ? (
            <>
              <button
                onClick={() => queueCleanupMutation.mutate({ id: chapter.id })}
                disabled={cleanupRunning || queueCleanupMutation.isPending}
                title={
                  cleanupRunning ? "Cleanup is running" :
                  cleanupStatus === "failed" ? "Retry the failed cleanup" :
                  cleanupStatus === "done" ? "Run the AI cleanup again on the current text" :
                  "Ask DeepSeek to strip OCR artifacts from this chapter without altering the prose"
                }
                className="text-xs px-2.5 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="chapter-cleanup"
              >
                {cleanupLabel}
              </button>
              <button
                onClick={() => stopCleanupMutation.mutate({ id: chapter.id })}
                disabled={!cleanupRunning || stopCleanupMutation.isPending}
                title={cleanupRunning ? "Stop the cleanup — the chapter text stays unchanged" : "Nothing is running"}
                className="text-xs px-2.5 py-1 rounded bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border) font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="chapter-cleanup-stop"
              >
                Stop
              </button>
              {cleanupRunning ? (
                <span className="text-xs text-purple-600" data-testid="chapter-cleanup-progress">
                  Cleaning{chapter.cleanup?.progress ? ` · ${chapter.cleanup.progress} chunks` : ""}...
                </span>
              ) : cleanupStatus === "failed" && chapter.cleanup?.error ? (
                <span className="text-xs text-red-600 truncate" title={chapter.cleanup.error}>
                  Cleanup failed: {chapter.cleanup.error}
                </span>
              ) : null}
              {queueCleanupMutation.error || stopCleanupMutation.error ? (
                <span className="text-xs text-red-600 truncate">
                  {(queueCleanupMutation.error ?? stopCleanupMutation.error)?.message}
                </span>
              ) : null}
            </>
          ) : null}
          {isTranslation ? (
            <>
              <button
                onClick={handleTranslate}
                disabled={translationRunning || startTranslationMutation.isPending}
                title={
                  translationRunning ? "Translation is running" :
                  translationStatus === "suspended" ? "Continue from where it stopped" :
                  translationStatus === "failed" ? "Retry the failed translation" :
                  translationStatus === "done" ? "Discard this translation and translate again" :
                  `Translate this chapter to ${language}`
                }
                className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="chapter-translate"
              >
                {translateLabel}
              </button>
              <button
                onClick={() => stopTranslationMutation.mutate({ chapterId: chapter.id, language: language! })}
                disabled={!translationRunning || stopTranslationMutation.isPending}
                title={translationRunning ? "Stop and keep everything translated so far" : "Nothing is running"}
                className="text-xs px-2.5 py-1 rounded bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border) font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="chapter-translate-stop"
              >
                Stop
              </button>
              <button
                onClick={() => setShowCompare(true)}
                title="Review original and translation side by side"
                className="text-xs px-2.5 py-1 rounded bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border) font-medium"
                data-testid="chapter-compare"
              >
                Compare
              </button>
              {translationRunning ? (
                <span className="text-xs text-blue-600" data-testid="chapter-translation-progress">
                  Translating{translationDetail?.progress ? ` · ${translationDetail.progress} chunks` : ""}...
                </span>
              ) : translationStatus === "failed" && translationDetail?.error ? (
                <span className="text-xs text-red-600 truncate" title={translationDetail.error}>
                  Failed: {translationDetail.error}
                </span>
              ) : null}
              {startTranslationMutation.error || stopTranslationMutation.error ? (
                <span className="text-xs text-red-600 truncate">
                  {(startTranslationMutation.error ?? stopTranslationMutation.error)?.message}
                </span>
              ) : null}
            </>
          ) : null}
          <div className="flex-1" />
          {onSwitchLanguage && languages && languages.length > 0 && !isEditing ? (
            <div className="flex items-center gap-1 mr-2" data-testid="modal-language-switcher">
              <button
                onClick={() => onSwitchLanguage(null)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                  !language
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
              >
                Original
              </button>
              {languages.map((l) => (
                <button
                  key={l}
                  onClick={() => onSwitchLanguage(l)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    language === l
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          ) : null}
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
                className="text-xs px-2.5 py-1 rounded bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border) font-medium"
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
              {fullChapter && !isTranslation ? (
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
                hasSourceBlocks={chapter.hasSourceBlocks}
              />
            </div>
          )}
        </div>

        {fullChapter?.chunkPreviews.length ? (
          <ChunkPreviewPanel
            chunkPreviews={fullChapter.chunkPreviews}
            selectedUrl={selectedChunkPreviewUrl}
            onSelect={selectChunk}
            playNonce={playNonce}
            hoveredUrl={hoveredChunkUrl}
            onHover={setHoveredChunkUrl}
            isSynthesizing={chapter.status === "synthesizing"}
            sourcePage={activeChunkPage}
            canOpenPdf={sourceFile !== undefined}
            onOpenPdf={setPdfPage}
          />
        ) : null}

        <div className="flex-1 min-h-[40vh] flex flex-col p-5">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-sm text-(--text-faint)">
              Loading text...
            </div>
          ) : fullChapter ? (
            isEditing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="flex-1 min-h-0 rounded bg-(--bg-card) border border-amber-300 p-4 font-mono text-xs text-(--text-secondary) whitespace-pre-wrap leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            ) : viewMode === "blocks" && fullChapter.sourceBlocks ? (
              <BlocksPreview
                sourceBlocks={fullChapter.sourceBlocks as SourceBlock[]}
                onOpenPdf={sourceFile ? setPdfPage : undefined}
              />
            ) : isTranslation && !fullChapter.rawText ? (
              <div className="flex items-center justify-center flex-1 text-sm text-(--text-muted)">
                {translationRunning ? "Waiting for the first chunk..." : `No ${language} translation text yet.`}
              </div>
            ) : (
              <TextPreview
                rawText={fullChapter.rawText}
                cleanText={fullChapter.cleanText}
                customText={fullChapter.customText}
                viewMode={viewMode}
                chunkRanges={chunkRanges}
                selectedChunkUrl={activeChunkUrl}
                onSelectChunk={selectChunk}
                hoveredChunkUrl={hoveredChunkUrl}
                onHoverChunk={setHoveredChunkUrl}
              />
            )
          ) : isTranslation ? (
            <div className="flex flex-col items-center justify-center gap-3 flex-1 text-sm text-(--text-muted)">
              <span>No {language} translation for this chapter yet.</span>
              <button
                onClick={handleTranslate}
                disabled={startTranslationMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50"
                data-testid="chapter-translate-empty"
              >
                {startTranslationMutation.isPending ? "Starting..." : `Translate to ${language}`}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 text-sm text-(--text-muted)">
              Failed to load chapter text
            </div>
          )}
        </div>
      </div>
      {pdfPage !== null && sourceFile ? (
        <PdfPreviewModal
          fileId={sourceFile.id}
          page={pdfPage}
          filename={sourceFile.filename}
          onClose={() => setPdfPage(null)}
        />
      ) : null}
      {showCompare && language ? (
        <TranslationModal
          bookId={bookId}
          chapters={chapters}
          initialLanguage={language}
          initialChapterId={chapter.id}
          onClose={() => {
            setShowCompare(false);
            refreshTranslations();
          }}
        />
      ) : null}
    </div>
  );
}

function ChunkPreviewPanel({
  chunkPreviews,
  selectedUrl,
  onSelect,
  playNonce,
  hoveredUrl,
  onHover,
  isSynthesizing,
  sourcePage,
  canOpenPdf,
  onOpenPdf,
}: {
  chunkPreviews: Array<{ index: number; fileName: string; url: string; page?: number }>;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  playNonce: number;
  hoveredUrl: string | null;
  onHover: (url: string | null) => void;
  isSynthesizing: boolean;
  sourcePage: number | null;
  canOpenPdf: boolean;
  onOpenPdf: (page: number) => void;
}) {
  const activeUrl = selectedUrl ?? chunkPreviews.at(-1)?.url ?? null;
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Ref mirror of the chosen rate so play handlers always read the latest without stale closures.
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  function playActive() {
    const audio = audioRef.current;
    if (!audio) return;
    // Apply the speed only after play() resolves: by then the load has settled, so the browser
    // won't snap playbackRate back to 1x (which is what happens if you set it before the load).
    audio.play().then(() => { audio.playbackRate = playbackRateRef.current; }).catch(() => {});
  }

  // Apply speed changes immediately while a chunk is already playing.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Auto-play whenever the user explicitly picks a chunk (playNonce changes), but not on the
  // initial mount or the programmatic auto-select during synthesis (playNonce stays 0 then).
  useEffect(() => {
    if (playNonce > 0) playActive();
  }, [playNonce]);

  // Keep the active chunk's button visible in the scrollable list when the selection changes.
  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeUrl]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) playActive();
    else audio.pause();
  }

  // When a chunk finishes, roll on to the next one (audiobook-style). Selecting it bumps playNonce,
  // which auto-plays it. Pausing stops the chain since a paused chunk never fires "ended".
  function handleEnded() {
    const idx = chunkPreviews.findIndex((preview) => preview.url === activeUrl);
    const next = idx >= 0 ? chunkPreviews[idx + 1] : undefined;
    if (next) onSelect(next.url);
    else setIsPlaying(false);
  }

  return (
    <div className="border-b border-(--border) px-5 py-3 bg-(--bg-card)">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {activeUrl ? (
            <button
              onClick={togglePlay}
              title={isPlaying ? "Pause" : "Play — auto-advances through chunks"}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
            >
              {isPlaying ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6 4h3v12H6zM11 4h3v12h-3z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 translate-x-px" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6 4l10 6-10 6V4z" />
                </svg>
              )}
            </button>
          ) : null}
          {activeUrl ? (
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              title="Playback speed"
              className="rounded border border-(--border) bg-(--bg-subtle) px-1 py-0.5 text-xs text-(--text-tertiary)"
            >
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          ) : null}
          <div className="text-xs font-medium text-(--text-primary)">
            Chunk previews {isSynthesizing ? `(live: ${chunkPreviews.length} ready)` : `(${chunkPreviews.length})`}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenPdf(sourcePage!)}
            disabled={!canOpenPdf || sourcePage === null}
            title={
              !canOpenPdf
                ? "Source PDF unknown for this chapter"
                : sourcePage === null
                  ? "No page info for this chunk"
                  : "Open the source PDF at this chunk's page"
            }
            className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            PDF{sourcePage !== null ? ` p.${sourcePage}` : ""}
          </button>
          <a
            href={chunkPreviews.at(-1)?.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            Open latest file
          </a>
        </div>
      </div>

      <div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
        {chunkPreviews.map((preview) => {
          const active = preview.url === activeUrl;
          const linked = !active && preview.url === hoveredUrl;
          return (
            <button
              key={preview.fileName}
              ref={active ? activeButtonRef : undefined}
              onClick={() => onSelect(preview.url)}
              onMouseEnter={() => onHover(preview.url)}
              onMouseLeave={() => onHover(null)}
              title={preview.page !== undefined ? `PDF page ${preview.page}` : undefined}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : linked
                    ? "bg-yellow-300/40 text-(--text-primary)"
                    : "bg-(--bg-subtle) text-(--text-tertiary) hover:bg-(--border)"
              }`}
            >
              Chunk {preview.index}
            </button>
          );
        })}
      </div>

      {activeUrl ? (
        <audio
          ref={audioRef}
          src={activeUrl}
          controls
          preload="none"
          className="h-8 w-full max-w-xl"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          // Scrubbing can reset the rate to 1x; re-assert the chosen speed after a seek.
          onSeeked={(e) => { e.currentTarget.playbackRate = playbackRateRef.current; }}
          onEnded={handleEnded}
        />
      ) : null}
    </div>
  );
}

function ViewModeTabs({
  viewMode,
  onSetViewMode,
  hasCleanText,
  hasCustomText,
  hasSourceBlocks,
}: {
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  hasCleanText: boolean;
  hasCustomText: boolean;
  hasSourceBlocks: boolean;
}) {
  const modes: ViewMode[] = [];
  if (hasCustomText) modes.push("custom");
  if (hasCleanText) modes.push("clean");
  modes.push("raw");
  if (hasCleanText) modes.push("split");
  if (hasSourceBlocks) modes.push("blocks");

  if (modes.length <= 1) return null;

  return (
    <div className="flex rounded-md border border-(--border) overflow-hidden text-xs">
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onSetViewMode(mode)}
          className={`px-2.5 py-1 capitalize ${
            viewMode === mode
              ? "bg-zinc-800 text-white"
              : "bg-(--bg-card) text-(--text-tertiary) hover:bg-(--bg-card-hover)"
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

type ChunkRange = { start: number; end: number; url: string };

function TextPreview({
  rawText,
  cleanText,
  customText,
  viewMode,
  chunkRanges,
  selectedChunkUrl,
  onSelectChunk,
  hoveredChunkUrl,
  onHoverChunk,
}: {
  rawText: string;
  cleanText: string | null;
  customText: string | null;
  viewMode: ViewMode;
  chunkRanges: ChunkRange[];
  selectedChunkUrl: string | null;
  onSelectChunk: (url: string) => void;
  hoveredChunkUrl: string | null;
  onHoverChunk: (url: string | null) => void;
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

  const textClass = "flex-1 min-h-0 overflow-y-auto rounded bg-(--bg-subtle) border border-(--border) p-4 font-mono text-xs text-(--text-secondary) whitespace-pre-wrap leading-relaxed";

  if (viewMode === "split" && cleanText) {
    return (
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <span className="text-[10px] uppercase tracking-wider text-(--text-faint) mb-1 font-medium shrink-0">Raw</span>
          <div
            ref={leftRef}
            onScroll={() => handleScroll("left")}
            className={textClass}
          >
            {rawText}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <span className="text-[10px] uppercase tracking-wider text-(--text-faint) mb-1 font-medium shrink-0">Clean</span>
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
      <ChunkedText
        text={customText}
        chunkRanges={chunkRanges}
        selectedChunkUrl={selectedChunkUrl}
        onSelectChunk={onSelectChunk}
        hoveredChunkUrl={hoveredChunkUrl}
        onHoverChunk={onHoverChunk}
        className={textClass + " border-(--border-custom-text) bg-(--bg-custom-text)"}
      />
    );
  }

  const text = viewMode === "clean" && cleanText ? cleanText : rawText;

  return (
    <ChunkedText
      text={text}
      chunkRanges={chunkRanges}
      selectedChunkUrl={selectedChunkUrl}
      onSelectChunk={onSelectChunk}
      hoveredChunkUrl={hoveredChunkUrl}
      onHoverChunk={onHoverChunk}
      className={textClass}
    />
  );
}

function ChunkedText({
  text,
  chunkRanges,
  selectedChunkUrl,
  onSelectChunk,
  hoveredChunkUrl,
  onHoverChunk,
  className,
}: {
  text: string;
  chunkRanges: ChunkRange[];
  selectedChunkUrl: string | null;
  onSelectChunk: (url: string) => void;
  hoveredChunkUrl: string | null;
  onHoverChunk: (url: string | null) => void;
  className: string;
}) {
  const selectedRef = useRef<HTMLElement>(null);

  // Scroll the selected chunk into view whenever the selection changes.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, [selectedChunkUrl]);

  if (chunkRanges.length === 0) {
    return <div className={className}>{text}</div>;
  }

  // Sort by start and drop overlaps so segments tile the text cleanly.
  const ordered = [...chunkRanges].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let pos = 0;
  ordered.forEach((range, i) => {
    if (range.start < pos) return;
    if (range.start > pos) parts.push(text.slice(pos, range.start));
    const isSelected = range.url === selectedChunkUrl;
    const isHovered = !isSelected && range.url === hoveredChunkUrl;
    parts.push(
      <span
        key={`${range.url}-${i}`}
        ref={isSelected ? selectedRef : undefined}
        onClick={() => onSelectChunk(range.url)}
        onMouseEnter={() => onHoverChunk(range.url)}
        onMouseLeave={() => onHoverChunk(null)}
        className={`cursor-pointer rounded-sm transition-colors ${
          isSelected
            ? "bg-yellow-300/70 text-(--text-primary)"
            : isHovered
              ? "bg-yellow-300/40 text-(--text-primary)"
              : ""
        }`}
      >
        {text.slice(range.start, range.end)}
      </span>,
    );
    pos = range.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));

  return <div className={className}>{parts}</div>;
}

function BlocksPreview({ sourceBlocks, onOpenPdf }: { sourceBlocks: SourceBlock[]; onOpenPdf?: (page: number) => void }) {
  let lastPage = -1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded bg-(--bg-subtle) border border-(--border) p-2 font-mono text-xs leading-relaxed">
      {sourceBlocks.map((block, i) => {
        const showPageDivider = block.page !== lastPage && lastPage !== -1;
        lastPage = block.page;
        return (
          <div key={i}>
            {showPageDivider ? (
              <div className="border-t border-(--divide) my-1.5" />
            ) : null}
            <div className={`flex gap-2 py-0.5 px-1.5 rounded ${block.included ? "" : "opacity-35"}`}>
              {onOpenPdf ? (
                <button
                  onClick={() => onOpenPdf(block.page)}
                  className="text-blue-600 hover:text-blue-800 tabular-nums shrink-0 w-8 text-right"
                  title="Open the source PDF at this page"
                >
                  {block.page}
                </button>
              ) : (
                <span className="text-(--text-faint) tabular-nums shrink-0 w-8 text-right">{block.page}</span>
              )}
              <span className={`shrink-0 w-24 truncate ${block.included ? "text-(--text-muted)" : "text-(--text-faint) line-through"}`}>
                {block.type}
              </span>
              <span className={`min-w-0 ${block.included ? "text-(--text-secondary)" : "text-(--text-faint)"} truncate`}>
                {block.text}
              </span>
            </div>
          </div>
        );
      })}
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
