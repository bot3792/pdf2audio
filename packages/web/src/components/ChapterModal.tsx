import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { PdfPreviewModal } from "./PdfPreviewModal.tsx";
import { ChapterAiModal } from "./ChapterAiModal.tsx";
import { VariantModal } from "./VariantModal.tsx";
import { VoicePickerChip } from "./VoicePicker.tsx";
import { TOOLBAR_BUTTON } from "../lib/button-classes.ts";
import { getVoiceLabel } from "../lib/voices.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";
import { CueTranscript } from "./reader/CueTranscript.tsx";
import { CuePages } from "./reader/CuePages.tsx";
import { cueIndexAt, fetchCues, fetchManifest, wordIndexAt, type ReaderCues, type ReaderManifest } from "../lib/reader-doc.ts";
import { followCue, type FollowBand } from "../lib/cue-follow.ts";
import type { ChapterRow, FileInfo, VariantRef } from "./ChapterTable.tsx";

type ChapterModalProps = {
  bookId: string;
  chapters: ChapterRow[];
  files?: FileInfo[];
  chapterIndex: number;
  // When set, the modal shows this variant's text, chunk previews, and audio
  variant?: VariantRef | null;
  variants?: VariantRef[];
  onSwitchVariant?: (key: string | null) => void;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onQueue: (id: string, resume?: boolean) => void;
  onSetSelected: (id: string, selected: boolean) => void;
  // Voice the next synthesis will use for this view (variant lane or book)
  synthVoice?: string;
  // Changes the stored voice for the whole book (or the active variant lane)
  onChangeSynthVoice?: (voice: string) => void;
};

export function chapterAudioDownload(chapter: ChapterRow, variant?: VariantRef | null) {
  // Legacy chapters synthesized before the AAC switch are still .mp3 on disk
  const ext = chapter.audioPath?.match(/\.\w+$/)?.[0] ?? ".m4a";
  return {
    href: chapter.audioUrl ?? `/audio/chapter/${chapter.id}`,
    filename: `${chapter.index + 1} ${chapter.title}${variant ? ` (${variant.label ?? variant.key})` : ""}${ext}`.replace(/[\\/]/g, "-"),
  };
}

type SourceBlock = {
  type: string;
  text: string;
  page: number;
  included: boolean;
  level?: number;
  polygon?: number[][];
};

// No sticky bar inside the panel, so the cue may sit closer to its top than in the reader
const MODAL_BAND: FollowBand = { top: 24, bottom: 90, landing: 0.25 };

type ViewMode = "readalong" | "text" | "custom" | "clean" | "raw" | "split" | "blocks";

export function ChapterModal({
  bookId,
  chapters,
  files,
  chapterIndex,
  variant,
  variants,
  onSwitchVariant,
  onClose,
  onNavigate,
  onQueue,
  onSetSelected,
  synthVoice,
  onChangeSynthVoice,
}: ChapterModalProps) {
  useBodyScrollLock();
  const chapter = chapters[chapterIndex];
  const hasPrev = chapterIndex > 0;
  const hasNext = chapterIndex < chapters.length - 1;

  const [viewMode, setViewMode] = useState<ViewMode>(chapter.hasCustomText ? "custom" : chapter.hasCleanText ? "clean" : "raw");
  const [cues, setCues] = useState<ReaderCues | null>(null);
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [ms, setMs] = useState(0);
  const seekRef = useRef<((ms: number) => void) | null>(null);
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
  const [showAi, setShowAi] = useState(false);

  useEffect(() => {
    setViewMode(chapter.hasCustomText ? "custom" : chapter.hasCleanText ? "clean" : "raw");
    setIsEditing(false);
    setSelectedChunkPreviewUrl(null);
    setPdfPage(null);
  }, [chapterIndex, variant?.key]);

  const isVariant = !!variant;

  useEffect(() => {
    setCues(null);
    setMs(0);
    if (isVariant || chapter.status !== "done") return;
    fetchCues(`/read/chapter/${chapter.id}/cues.json`).then(setCues).catch(() => setCues(null));
  }, [chapter.id, chapter.status, isVariant]);

  // The pages are only worth fetching for a chapter whose text still maps onto them
  useEffect(() => {
    setManifest(null);
    if (isVariant) return;
    fetchManifest(bookId)
      .then((doc) => setManifest(doc.chapters.some((c) => c.i === chapter.index && c.mode === "page") ? doc : null))
      .catch(() => setManifest(null));
  }, [bookId, chapter.index, isVariant]);

  const readerChapter = manifest?.chapters.find((entry) => entry.i === chapter.index);
  const activeCueIndex = cues ? cueIndexAt(cues.cues, ms) : -1;

  const activeWordIndex = cues && activeCueIndex >= 0 ? wordIndexAt(cues.cues[activeCueIndex], ms) : -1;
  const followAnchor = `${chapter.id}:${viewMode}`;
  const settledAt = useRef("");

  // The modal scrolls its own panel rather than the window, which followCue works out for itself
  useEffect(() => {
    if (followCue(MODAL_BAND, { jump: settledAt.current !== followAnchor })) settledAt.current = followAnchor;
  }, [activeCueIndex, activeWordIndex, followAnchor]);

  // Reading along on the page is the experience; text is the fallback when there is no page
  useEffect(() => {
    if (cues) setViewMode(manifest ? "readalong" : "text");
  }, [cues, manifest]);

  const isTranslationKind = variant?.kind === "translation";
  const variantName = variant ? variant.label ?? variant.key : null;
  const { data: originalChapter, isLoading: originalLoading } = trpc.chapters.get.useQuery(
    { id: chapter.id },
    { enabled: !isVariant, refetchInterval: chapter.status === "synthesizing" ? 1000 : false },
  );
  const { data: variantDetail, isLoading: variantLoading } = trpc.variants.detail.useQuery(
    { chapterId: chapter.id, key: variant?.key ?? "" },
    {
      enabled: isVariant,
      retry: false,
      // A variant's audio run only moves audioStatus — chapters.status and the variant's own
      // text status both stay "done" — so polling has to watch that field or it never runs.
      refetchInterval: (query) => {
        const d = query.state.data;
        const busy =
          d?.status === "pending" ||
          d?.status === "translating" ||
          d?.audioStatus === "pending" ||
          d?.audioStatus === "synthesizing" ||
          chapter.status === "synthesizing";
        return busy ? 1000 : false;
      },
    },
  );
  const fullChapter = isVariant
    ? variantDetail && {
        rawText: variantDetail.text,
        cleanText: null,
        customText: null,
        sourceBlocks: null,
        chunkTextSource: "raw" as const,
        chunkPreviews: variantDetail.chunkPreviews,
      }
    : originalChapter;
  const isLoading = isVariant ? variantLoading : originalLoading;
  const utils = trpc.useUtils();

  // Polling stops the instant synthesis ends, but the worker deletes the chunk WAVs when it builds
  // the sync map — so without one final fetch the panel keeps pointing at files that no longer
  // exist and play() fails silently until a page reload. Variants track their own audioStatus.
  const audioBusy = isVariant
    ? variantDetail?.audioStatus === "synthesizing" || variantDetail?.audioStatus === "pending"
    : chapter.status === "synthesizing";
  // Partial audio exists, so "start over" and "carry on" are genuinely different actions here.
  const canContinueSynthesis = chapter.status === "suspended" || chapter.status === "failed";
  const withVoice = synthVoice ? ` with ${getVoiceLabel(synthVoice)}` : "";
  const wasAudioBusyRef = useRef(audioBusy);
  useEffect(() => {
    const was = wasAudioBusyRef.current;
    wasAudioBusyRef.current = audioBusy;
    if (!was || audioBusy) return;
    utils.chapters.get.invalidate({ id: chapter.id });
    if (variant?.key) utils.variants.detail.invalidate({ chapterId: chapter.id, key: variant.key });
  }, [audioBusy, chapter.id, variant?.key, utils]);

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

  const refreshVariants = () => {
    utils.variants.detail.invalidate();
    utils.variants.listForBook.invalidate();
    utils.variants.list.invalidate();
    utils.books.logs.invalidate();
  };
  const startVariantMutation = trpc.variants.start.useMutation({ onSuccess: refreshVariants });
  const stopVariantMutation = trpc.variants.stop.useMutation({ onSuccess: refreshVariants });

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

  const variantStatus = isVariant ? variantDetail?.status : undefined;
  const variantRunning = variantStatus === "pending" || variantStatus === "translating";
  const runLabel =
    variantStatus === "suspended" ? "Resume" :
    variantStatus === "failed" ? "Retry" :
    variantStatus === "done" ? (isTranslationKind ? "Re-translate" : "Re-run") :
    (isTranslationKind ? "Translate" : "Run");

  function handleRunVariant() {
    startVariantMutation.mutate({
      chapterId: chapter.id,
      key: variant!.key,
      restart: variantStatus === "done",
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
      <div className="relative bg-(--bg-card) rounded-xl shadow-2xl w-[92vw] max-w-6xl h-[92vh] flex flex-col">
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
              {!isVariant && chapter.cleanup?.status === "done" ? (
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
              {readerChapter ? (
                <Link
                  to={`/books/${bookId}/read?chapter=${chapter.index}`}
                  className="text-blue-600 hover:text-blue-800"
                  title="Follow the narration on the page itself, at full size"
                  data-testid="chapter-read-along"
                >
                  Read along on the page
                </Link>
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

        <div className="flex flex-wrap items-center gap-2 px-5 py-2 border-b border-(--border) bg-(--bg-subtle)">
          {chapter.status === "done" && chapter.audioPath ? (
            <div className="flex items-center gap-2 mr-1">
              {/* Named because the chunk scrubber further down is an identical-looking control. */}
              <span className="text-xs text-(--text-faint) shrink-0">Whole chapter</span>
              <audio key={`${chapter.id}-${variant?.key ?? "original"}`} controls preload="none" className="h-8">
                <source src={chapter.audioUrl ?? `/audio/chapter/${chapter.id}`} />
              </audio>
            </div>
          ) : null}
          {chapter.status === "done" && chapter.audioPath ? (
            <a
              href={chapterAudioDownload(chapter, variant).href}
              download={chapterAudioDownload(chapter, variant).filename}
              title={`Download the ${variantName ?? "chapter"} audio`}
              className={`${TOOLBAR_BUTTON} no-underline`}
            >
              Download
            </a>
          ) : (
            <button
              disabled
              title={`No ${variantName ?? "chapter"} audio to download yet`}
              className={TOOLBAR_BUTTON}
            >
              Download
            </button>
          )}

          <Divider />

          {/* The voice is the input to the buttons beside it, so it leads the group rather than
              trailing it — and it opens a modal, so it must not read as a <select>. */}
          {synthVoice && onChangeSynthVoice ? (
            <VoicePickerChip
              value={synthVoice}
              onChange={onChangeSynthVoice}
              title={`Voice for the next synthesis — changing it applies to the whole ${isVariant ? `${variantName} lane` : "book"}`}
            />
          ) : synthVoice ? (
            <span
              className="text-xs text-(--text-faint)"
              title={`Next synthesis uses this voice — change it via "Synthesize selected" above the chapter table`}
            >
              {getVoiceLabel(synthVoice)}
            </span>
          ) : null}
          {canContinueSynthesis ? (
            <button
              onClick={() => onQueue(chapter.id, true)}
              title="Continue synthesis from where it stopped — keeps the chunks already synthesized"
              className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
            >
              Continue{chapter.progress ? ` (${chapter.progress})` : ""}
            </button>
          ) : null}
          <button
            onClick={() => onQueue(chapter.id)}
            disabled={["pending", "normalizing", "synthesizing"].includes(chapter.status) || chapter.synthesizable === false}
            title={
              chapter.synthesizable === false
                ? `No finished ${variantName} text for this chapter`
                : ["pending", "normalizing", "synthesizing"].includes(chapter.status)
                  ? "Can't re-synthesize while it's being processed"
                  : canContinueSynthesis
                    ? `Discard the ${chapter.progress ?? "already-synthesized"} chunks and synthesize the whole chapter again${withVoice}`
                    : `Re-synthesize this chapter's audio from text (from scratch)${withVoice}`
            }
            className={TOOLBAR_BUTTON}
          >
            {canContinueSynthesis ? "Start over" : "Re-synthesize"}
          </button>

          <Divider />

          <button
            onClick={() => setShowAi(true)}
            title="Summarize, question, or run any prompt against this chapter's text"
            className={TOOLBAR_BUTTON}
            data-testid="chapter-ask-ai"
          >
            Ask AI
          </button>
          {!isVariant ? (
            <>
              <button
                onClick={() => queueCleanupMutation.mutate({ id: chapter.id })}
                disabled={cleanupRunning || queueCleanupMutation.isPending}
                title={
                  cleanupRunning ? "Cleanup is running" :
                  cleanupStatus === "failed" ? "Retry the failed cleanup" :
                  cleanupStatus === "done" ? "Run the AI cleanup again on the current text" :
                  "Ask AI to strip OCR artifacts from this chapter without altering the prose"
                }
                className={TOOLBAR_BUTTON}
                data-testid="chapter-cleanup"
              >
                {cleanupLabel}
              </button>
              <button
                onClick={() => stopCleanupMutation.mutate({ id: chapter.id })}
                disabled={!cleanupRunning || stopCleanupMutation.isPending}
                title={cleanupRunning ? "Stop the cleanup — the chapter text stays unchanged" : "Nothing is running"}
                className={TOOLBAR_BUTTON}
                data-testid="chapter-cleanup-stop"
              >
                Stop cleanup
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
          {isVariant ? (
            <>
              <button
                onClick={handleRunVariant}
                disabled={variantRunning || startVariantMutation.isPending}
                title={
                  variantRunning ? `${variantName} is running` :
                  variantStatus === "suspended" ? "Continue from where it stopped" :
                  variantStatus === "failed" ? "Retry the failed run" :
                  variantStatus === "done" ? `Discard this ${variantName} text and generate it again` :
                  isTranslationKind ? `Translate this chapter to ${variantName}` : `Rewrite this chapter as ${variantName}`
                }
                className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="chapter-translate"
              >
                {runLabel}
              </button>
              <button
                onClick={() => stopVariantMutation.mutate({ chapterId: chapter.id, key: variant!.key })}
                disabled={!variantRunning || stopVariantMutation.isPending}
                title={variantRunning ? "Stop and keep everything generated so far" : "Nothing is running"}
                className={TOOLBAR_BUTTON}
                data-testid="chapter-translate-stop"
              >
                Stop {isTranslationKind ? "translation" : "rewrite"}
              </button>
              <button
                onClick={() => setShowCompare(true)}
                title="Review the original and this variant side by side"
                className={TOOLBAR_BUTTON}
                data-testid="chapter-compare"
              >
                Compare
              </button>
              {variantRunning ? (
                <span className="text-xs text-blue-600" data-testid="chapter-translation-progress">
                  {isTranslationKind ? "Translating" : "Rewriting"}{variantDetail?.progress ? ` · ${variantDetail.progress} chunks` : ""}...
                </span>
              ) : variantStatus === "failed" && variantDetail?.error ? (
                <span className="text-xs text-red-600 truncate" title={variantDetail.error}>
                  Failed: {variantDetail.error}
                </span>
              ) : null}
              {startVariantMutation.error || stopVariantMutation.error ? (
                <span className="text-xs text-red-600 truncate">
                  {(startVariantMutation.error ?? stopVariantMutation.error)?.message}
                </span>
              ) : null}
            </>
          ) : null}
          <div className="flex-1" />
          {onSwitchVariant && variants && variants.length > 0 && !isEditing ? (
            <div className="flex items-center gap-1 mr-2" data-testid="modal-language-switcher">
              <button
                onClick={() => onSwitchVariant(null)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                  !variant
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
              >
                Original
              </button>
              {variants.map((v) => (
                <button
                  key={v.key}
                  onClick={() => onSwitchVariant(v.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    variant?.key === v.key
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                  }`}
                >
                  {v.label ?? v.key}
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
              {fullChapter && !isVariant ? (
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
                hasCues={cues !== null}
                hasPages={manifest !== null && readerChapter !== undefined}
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
            onFollow={setSelectedChunkPreviewUrl}
            playNonce={playNonce}
            hoveredUrl={hoveredChunkUrl}
            onHover={setHoveredChunkUrl}
            isSynthesizing={chapter.status === "synthesizing"}
            sourcePage={activeChunkPage}
            canOpenPdf={sourceFile !== undefined}
            onOpenPdf={setPdfPage}
            onTime={setMs}
            seekRef={seekRef}
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
                className="flex-1 min-h-0 w-full max-w-4xl mx-auto rounded bg-(--bg-card) border border-amber-300 px-6 py-5 text-[15px] text-(--text-primary) whitespace-pre-wrap leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            ) : viewMode === "readalong" && cues && manifest && readerChapter ? (
              <div className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
                <CuePages
                  manifest={manifest}
                  chapter={readerChapter}
                  cues={cues}
                  ms={ms}
                  columns
                  onSeek={(at) => seekRef.current?.(at)}
                />
              </div>
            ) : viewMode === "text" && cues ? (
              <CueTranscript
                cues={cues}
                ms={ms}
                onSeek={(at) => seekRef.current?.(at)}
                className="mx-auto w-full max-w-4xl flex-1 min-h-0 overflow-y-auto rounded bg-(--bg-subtle) border border-(--border) px-6 py-5 text-[15px] leading-relaxed text-(--text-primary)"
              />
            ) : viewMode === "blocks" && fullChapter.sourceBlocks ? (
              <BlocksPreview
                sourceBlocks={fullChapter.sourceBlocks as SourceBlock[]}
                onOpenPdf={sourceFile ? setPdfPage : undefined}
              />
            ) : isVariant && !fullChapter.rawText ? (
              <div className="flex items-center justify-center flex-1 text-sm text-(--text-muted)">
                {variantRunning ? "Waiting for the first chunk..." : `No ${variantName} text yet.`}
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
          ) : isVariant ? (
            <div className="flex flex-col items-center justify-center gap-3 flex-1 text-sm text-(--text-muted)">
              <span>No {variantName} text for this chapter yet.</span>
              <button
                onClick={handleRunVariant}
                disabled={startVariantMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50"
                data-testid="chapter-translate-empty"
              >
                {startVariantMutation.isPending ? "Starting..." : isTranslationKind ? `Translate to ${variantName}` : `Generate ${variantName}`}
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
      {showAi ? (
        <ChapterAiModal
          scope={{ kind: "chapters", bookId, chapters: [{ id: chapter.id, title: chapter.title }] }}
          onClose={() => setShowAi(false)}
        />
      ) : null}
      {showCompare && variant ? (
        <VariantModal
          bookId={bookId}
          chapters={chapters}
          initialKey={variant.key}
          initialChapterId={chapter.id}
          onClose={() => {
            setShowCompare(false);
            refreshVariants();
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
  onFollow,
  playNonce,
  hoveredUrl,
  onHover,
  isSynthesizing,
  sourcePage,
  canOpenPdf,
  onOpenPdf,
  onTime,
  seekRef,
}: {
  chunkPreviews: Array<{ index: number; fileName: string; url: string; page?: number; startMs?: number; endMs?: number }>;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  // Selection driven by playback progress — highlights without re-triggering auto-play
  onFollow: (url: string) => void;
  playNonce: number;
  hoveredUrl: string | null;
  onHover: (url: string | null) => void;
  isSynthesizing: boolean;
  sourcePage: number | null;
  canOpenPdf: boolean;
  onOpenPdf: (page: number) => void;
  onTime?: (ms: number) => void;
  seekRef?: React.RefObject<((ms: number) => void) | null>;
}) {
  const activeUrl = selectedUrl ?? chunkPreviews.at(-1)?.url ?? null;
  const activeIndex = chunkPreviews.findIndex((preview) => preview.url === activeUrl);
  const activeChunk = activeIndex >= 0 ? chunkPreviews[activeIndex] : undefined;
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // After cleanup the chunk WAVs are gone: entries carry sync-map timings instead, and the
  // panel plays the chapter audio, seeking to each chunk's startMs.
  const syncMode = typeof chunkPreviews[0]?.startMs === "number";
  const audioSrc = syncMode ? activeUrl?.split("#")[0] ?? null : activeUrl;
  const pendingSeekRef = useRef<number | null>(null);

  // Ref mirror of the chosen rate so play handlers always read the latest without stale closures.
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  function playActive() {
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingSeekRef.current !== null && audio.readyState >= 1) {
      audio.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
    }
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
    if (playNonce > 0) {
      if (syncMode) {
        const target = chunkPreviews.find((preview) => preview.url === activeUrl);
        if (typeof target?.startMs === "number") pendingSeekRef.current = target.startMs / 1000;
      }
      playActive();
    }
  }, [playNonce]);

  // timeupdate fires a few times a second, which is enough to follow a chunk but not a word
  useEffect(() => {
    if (!onTime || !isPlaying) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) onTime(audioRef.current.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onTime, isPlaying]);

  useEffect(() => {
    if (!seekRef) return;
    seekRef.current = (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      onTime?.(ms);
      // preload="none" means currentTime is ignored until metadata arrives; the pending seek
      // is applied by playActive and by loadedmetadata, whichever gets there first
      pendingSeekRef.current = ms / 1000;
      playActive();
    };
    return () => { seekRef.current = null; };
  }, [seekRef, onTime]);

  function handleTimeUpdate() {
    const audio = audioRef.current;
    onTime?.((audio?.currentTime ?? 0) * 1000);
    if (!syncMode || !audio || audio.paused) return;
    const ms = audio.currentTime * 1000;
    const current = chunkPreviews.find(
      (preview) => preview.startMs! <= ms && ms < preview.endMs!,
    );
    if (current && current.url !== activeUrl) onFollow(current.url);
  }

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
  // Sync mode plays one continuous file, so "ended" only fires at the end of the chapter.
  function handleEnded() {
    if (syncMode) {
      setIsPlaying(false);
      return;
    }
    const next = activeIndex >= 0 ? chunkPreviews[activeIndex + 1] : undefined;
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

      {audioSrc ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--text-faint) shrink-0">Chunk {activeChunk?.index ?? "—"}</span>
          <audio
            ref={audioRef}
            src={audioSrc}
            controls
            preload={syncMode ? "metadata" : "none"}
            className="h-8 w-full max-w-xl"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            // Scrubbing can reset the rate to 1x; re-assert the chosen speed after a seek.
            onSeeked={(e) => { e.currentTarget.playbackRate = playbackRateRef.current; }}
            onLoadedMetadata={(e) => {
              if (pendingSeekRef.current !== null) {
                e.currentTarget.currentTime = pendingSeekRef.current;
                pendingSeekRef.current = null;
              }
            }}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
        </div>
      ) : null}
    </div>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-(--border) shrink-0" aria-hidden="true" />;
}

function ViewModeTabs({
  viewMode,
  onSetViewMode,
  hasCleanText,
  hasCustomText,
  hasSourceBlocks,
  hasCues,
  hasPages,
}: {
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  hasCleanText: boolean;
  hasCustomText: boolean;
  hasSourceBlocks: boolean;
  hasCues: boolean;
  hasPages: boolean;
}) {
  const modes: ViewMode[] = [];
  if (hasPages) modes.push("readalong");
  if (hasCues) modes.push("text");
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

  const textClass = "flex-1 min-h-0 overflow-y-auto rounded bg-(--bg-subtle) border border-(--border) px-6 py-5 text-[15px] text-(--text-primary) whitespace-pre-wrap leading-relaxed";
  const readingColumn = " w-full max-w-4xl mx-auto";

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
        className={textClass + readingColumn + " border-(--border-custom-text) bg-(--bg-custom-text)"}
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
      className={textClass + readingColumn}
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
