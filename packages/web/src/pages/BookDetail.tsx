import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "../trpc.ts";
import { ChapterTable } from "../components/ChapterTable.tsx";
import { voiceSupportsSpeedControl } from "../lib/voices.ts";
import { VoicePicker } from "../components/VoicePicker.tsx";
import { SpeedSlider } from "../components/SpeedSlider.tsx";
import { PdfPreviewModal } from "../components/PdfPreviewModal.tsx";

export function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: book, isLoading } = trpc.books.get.useQuery(
    { id: id! },
    {
      enabled: !!id,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return 3000;
        const hasActiveFiles = data.files?.some((f: { status: string }) =>
          f.status === "extracting" || f.status === "pending"
        );
        const hasActiveChapters = data.chapters?.some((c: { status: string }) =>
          ["synthesizing", "normalizing", "pending"].includes(c.status)
        );
        const bookActive = data.status === "extracting" || data.status === "assembling";
        return (hasActiveFiles || hasActiveChapters || bookActive) ? 2000 : false;
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

  // Book mutations
  const cancelMutation = trpc.books.cancel.useMutation({ onSuccess: invalidate });
  const retryMutation = trpc.books.retry.useMutation({ onSuccess: invalidate });
  const redetectMutation = trpc.books.redetectChapters.useMutation({ onSuccess: invalidate });
  const processSelectedMutation = trpc.books.processSelected.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.books.delete.useMutation({
    onSuccess: () => window.location.assign("/"),
  });
  const assembleMutation = trpc.books.assemble.useMutation({ onSuccess: invalidate });
  const deleteAssemblyMutation = trpc.books.deleteAssembly.useMutation({ onSuccess: invalidate });

  // Chapter mutations
  const queueMutation = trpc.chapters.queue.useMutation({ onSuccess: invalidate });
  const setSelectedMutation = trpc.chapters.setSelected.useMutation({ onSuccess: invalidate });
  const setAllSelectedMutation = trpc.chapters.setAllSelected.useMutation({ onSuccess: invalidate });
  const setSelectedBatchMutation = trpc.chapters.setSelectedBatch.useMutation({ onSuccess: invalidate });

  // File mutations
  const setFileSelectedMutation = trpc.bookFiles.setSelected.useMutation({ onSuccess: invalidate });
  const setAllFilesSelectedMutation = trpc.bookFiles.setAllSelected.useMutation({ onSuccess: invalidate });
  const setFileSelectedBatchMutation = trpc.bookFiles.setSelectedBatch.useMutation({ onSuccess: invalidate });
  const removeFileMutation = trpc.bookFiles.remove.useMutation({ onSuccess: invalidate });
  const reExtractFileMutation = trpc.bookFiles.reExtract.useMutation({ onSuccess: invalidate });
  const reExtractSelectedMutation = trpc.bookFiles.reExtractSelected.useMutation({ onSuccess: invalidate });
  const cancelFileMutation = trpc.bookFiles.cancel.useMutation({ onSuccess: invalidate });

  const [reExtractForceOcr, setReExtractForceOcr] = useState<boolean | null>(null);
  const [reExtractLlm, setReExtractLlm] = useState<boolean | null>(null);
  const renameMutation = trpc.books.rename.useMutation({ onSuccess: invalidate });
  const updateSettingsMutation = trpc.books.updateSettings.useMutation({ onSuccess: invalidate });
  const deleteChaptersMutation = trpc.chapters.deleteSelected.useMutation({ onSuccess: invalidate });
  const renameChapterMutation = trpc.chapters.rename.useMutation({ onSuccess: invalidate });
  const reorderChaptersMutation = trpc.chapters.reorder.useMutation({ onSuccess: invalidate });
  const setSkipSynthesisMutation = trpc.bookFiles.setSkipSynthesis.useMutation({ onSuccess: invalidate });

  if (isLoading || !book) {
    return (
      <div className="min-h-screen bg-(--bg-page)">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-(--text-muted)">Loading...</p>
        </div>
      </div>
    );
  }

  // Derived state
  const selectedCount = book.chapters.filter((c) => c.selected).length;
  const hasActiveFiles = book.files?.some((f) => f.status === "extracting" || f.status === "pending") ?? false;
  const hasActiveChapters = book.chapters.some((c) =>
    ["synthesizing", "normalizing", "pending"].includes(c.status)
  );
  const isProcessing = hasActiveFiles || hasActiveChapters ||
    book.status === "extracting" || book.status === "assembling";
  const selectedWithAudio = book.chapters.filter((c) => c.selected && c.status === "done" && c.audioPath).length;
  const selectedSynthesizable = book.chapters.filter(
    (c) => c.selected && (c.status === "failed" || c.status === "suspended" || c.status === "pending" || c.status === "done")
  ).length;
  const isAssembling = book.status === "assembling";
  const allSelectedDone = selectedCount > 0 && book.chapters.filter((c) => c.selected).every((c) => c.status === "done" && c.audioPath);
  const canAssemble = allSelectedDone && !isAssembling;
  const canProcess = selectedSynthesizable > 0 && !hasActiveChapters && !isAssembling;
  return (
    <div className="min-h-screen bg-(--bg-page)">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block">
          &larr; Back
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
             <EditableTitle
               title={book.title}
               onRename={(title) => renameMutation.mutate({ id: book.id, title })}
             />
             {book.skipSynthesis && (
               <p className="text-sm text-(--text-muted) mt-1">Reader mode</p>
             )}
           </div>
        </div>

        {book.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700 font-mono">{book.error}</p>
          </div>
        )}

        {/* TIER 1: Source Files */}
        {book.files && book.files.length > 0 && (
          <BookFilesSection
            files={book.files}
            chapters={book.chapters}
            bookId={book.id}
            isProcessing={isProcessing}
            onSetSelected={(fid, selected) => setFileSelectedMutation.mutate({ id: fid, selected })}
            onSetAllSelected={(selected) => setAllFilesSelectedMutation.mutate({ bookId: book.id, selected })}
            onSetSelectedBatch={(ids, selected) => setFileSelectedBatchMutation.mutate({ ids, selected })}
            onRemove={(fid) => removeFileMutation.mutate({ id: fid })}
            onReExtract={(fid) => reExtractFileMutation.mutate({ id: fid })}
            onReExtractSelected={() => reExtractSelectedMutation.mutate({ bookId: book.id })}
            onCancel={(fid) => cancelFileMutation.mutate({ id: fid })}
            onSetSkipSynthesis={(fid, skip) => setSkipSynthesisMutation.mutate({ id: fid, skipSynthesis: skip })}
            onFilesAdded={invalidate}
          />
        )}

        {/* TIER 2: Chapters */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-(--text-secondary)">Chapters</h2>
              {book.chapterDetection && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-(--bg-subtle) text-(--text-muted)"
                  title={{
                    "llm": "Boundaries picked by the local LLM from the table of contents",
                    "numbered-headings": "Numbered chapter headings (Chapter N) found in the document",
                    "heading-levels": "Split at the most plausible heading level",
                    "word-split": "No usable headings — split every ~5000 words",
                  }[book.chapterDetection]}
                >
                  {{
                    "llm": "LLM · ToC-matched",
                    "numbered-headings": "Chapter numbering",
                    "heading-levels": "Heading heuristic",
                    "word-split": "Word-count split",
                  }[book.chapterDetection]}
                </span>
              )}
            </div>
            {book.chapters.length > 0 && (
              <span className="text-sm text-(--text-muted)">
                {selectedCount} of {book.chapters.length} selected
              </span>
            )}
          </div>

          {/* Voice & speed settings */}
          <div className="flex items-end gap-4 mb-3">
            <div className="w-64">
              <VoicePicker
                value={book.voice}
                onChange={(voice) => updateSettingsMutation.mutate({ id: book.id, voice })}
              />
            </div>
            <SpeedSlider
              value={book.speed}
              onChange={(speed) => updateSettingsMutation.mutate({ id: book.id, speed })}
              disabled={!voiceSupportsSpeedControl(book.voice)}
            />
          </div>

          {/* Chapter action toolbar */}
          {book.chapters.length > 0 && (
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => processSelectedMutation.mutate({ id: book.id })}
                disabled={!canProcess || processSelectedMutation.isPending}
                title={
                  selectedSynthesizable === 0 ? "No selected chapters are ready for synthesis" :
                  hasActiveChapters ? "Wait for active chapters to finish" :
                  isAssembling ? "Wait for assembly to finish" :
                  `Use the current selected voice/model to synthesize the selected chapters`
                }
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Synthesize selected ({selectedSynthesizable})
              </button>
              <button
                onClick={() => assembleMutation.mutate({ id: book.id })}
                disabled={!canAssemble || assembleMutation.isPending}
                title={
                  selectedCount === 0 ? "No chapters selected" :
                  !allSelectedDone ? "All selected chapters must be done with audio" :
                  isAssembling ? "Assembly already in progress" :
                  undefined
                }
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {book.outputPath ? "Re-assemble" : "Assemble"} selected ({selectedWithAudio})
              </button>
              <button
                onClick={() => cancelMutation.mutate({ id: book.id })}
                disabled={!hasActiveChapters || cancelMutation.isPending}
                title={!hasActiveChapters ? "No chapters are actively processing" : undefined}
                className="px-4 py-2 bg-zinc-600 text-white rounded-md text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel processing
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedCount} selected chapter(s) and their audio?`)) {
                    deleteChaptersMutation.mutate({ bookId: book.id });
                  }
                }}
                disabled={selectedCount === 0 || hasActiveChapters || deleteChaptersMutation.isPending}
                title={
                  selectedCount === 0 ? "No chapters selected" :
                  hasActiveChapters ? "Wait for active chapters to finish" :
                  "Delete selected chapters and their audio"
                }
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete selected ({selectedCount})
              </button>
            </div>
          )}

          {book.chapters.length === 0 ? (
            <p className="text-(--text-muted) text-sm">
              {book.status === "extracting" || hasActiveFiles
                ? "Extracting chapters from PDF..."
                : "No chapters extracted yet."}
            </p>
          ) : (
            <ChapterTable
              bookId={book.id}
              chapters={book.chapters}
              files={book.files?.map((f) => ({ id: f.id, index: f.index, filename: f.filename }))}
              onQueue={(cid, resume) => queueMutation.mutate({ id: cid, resume })}
              onRename={(cid, title) => renameChapterMutation.mutate({ id: cid, title })}
              onReorder={(chapterIds) => reorderChaptersMutation.mutate({ bookId: book.id, chapterIds })}
              onSetSelected={(cid, selected) => setSelectedMutation.mutate({ id: cid, selected })}
              onSetAllSelected={(selected) => setAllSelectedMutation.mutate({ bookId: book.id, selected })}
              onSetSelectedBatch={(ids, selected) => setSelectedBatchMutation.mutate({ ids, selected })}
            />
          )}
        </div>

        {/* TIER 3: Assemblies */}
        {bookAssemblies.length > 0 && (
          <AssembliesSection
            assemblies={bookAssemblies}
            latestOutputPath={book.outputPath}
            onDelete={(aid) => deleteAssemblyMutation.mutate({ id: aid })}
            isDeleting={deleteAssemblyMutation.isPending}
          />
        )}

        {/* Logs */}
        <LogViewer
          bookId={book.id}
          isProcessing={isProcessing}
          files={book.files?.map((f) => ({ index: f.index, filename: f.filename }))}
        />

        {/* Danger zone */}
        <div className="border-t border-(--border) pt-6 mt-6">
          <h3 className="text-sm font-medium text-(--text-muted) uppercase tracking-wider mb-3">Book actions</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {!isProcessing && book.chapters.length > 0 && (
              <>
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
                    if (confirm("This will delete all chapters and re-extract from all PDFs. Continue?")) {
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
                  Re-extract entire book
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
                  className="px-4 py-2 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-sm font-medium hover:bg-(--border) disabled:opacity-50"
                >
                  Re-detect chapters
                </button>
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
              Delete book
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Assemblies Section ---

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
    <div className="mb-6">
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
                      <audio controls preload="none" className="h-8">
                        <source src={`/audio/assembly/${assembly.id}`} type="audio/mpeg" />
                      </audio>
                      <a
                        href={`/download/assembly/${assembly.id}`}
                        download={assembly.outputPath.split("/").pop()}
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

// --- Log Viewer ---

function LogViewer({ bookId, isProcessing, files }: { bookId: string; isProcessing: boolean; files?: { index: number; filename: string }[] }) {
  const [expanded, setExpanded] = useState(isProcessing);
  const [fileFilter, setFileFilter] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const utils = trpc.useUtils();
  const isMultiFile = files && files.length > 1;

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

  const filteredLogs = fileFilter
    ? logs.filter((entry) => entry.fileIndex === Number(fileFilter))
    : logs;

  if (logs.length === 0 && !isProcessing) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-(--text-tertiary) hover:text-(--text-primary)"
        >
          <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
          Logs ({filteredLogs.length}{fileFilter ? ` / ${logs.length}` : ""})
        </button>
        {isMultiFile && (
          <select
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            className="text-xs px-2 py-0.5 border border-(--border-input) rounded bg-(--bg-input) text-(--text-secondary)"
          >
            <option value="">All files</option>
            {files!.map((f) => (
              <option key={f.index} value={String(f.index)}>
                {f.index + 1}. {f.filename}
              </option>
            ))}
          </select>
        )}
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
          {filteredLogs.length === 0 ? (
            <p className="text-zinc-500">Waiting for logs...</p>
          ) : (
            filteredLogs.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <span className="text-zinc-500 shrink-0 select-none">
                  {formatLogTime(String(entry.createdAt))}
                </span>
                <span className="text-zinc-200 whitespace-pre-wrap break-all">
                  <LogMessageText message={entry.message} />
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LogMessageText({ message }: { message: string }) {
  const parts = message.split(/(\/files\/\S+)/g);

  return parts.map((part, index) => {
    if (!part.startsWith("/files/")) {
      return <span key={index}>{part}</span>;
    }

    return (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
      >
        {part}
      </a>
    );
  });
}

// --- Source Files Section ---

type BookFileRow = {
  id: string;
  index: number;
  filename: string;
  status: string;
  selected: boolean;
  skipSynthesis: boolean;
  error: string | null;
};

type ChapterRowForFiles = {
  sourceFileIndex: number | null;
  [key: string]: unknown;
};

function BookFilesSection({
  files,
  chapters,
  bookId,
  onSetSelected,
  onSetAllSelected,
  onSetSelectedBatch,
  onRemove,
  onReExtract,
  onReExtractSelected,
  onCancel,
  onSetSkipSynthesis,
  onFilesAdded,
}: {
  files: BookFileRow[];
  chapters: ChapterRowForFiles[];
  bookId: string;
  isProcessing: boolean;
  onSetSelected: (id: string, selected: boolean) => void;
  onSetAllSelected: (selected: boolean) => void;
  onSetSelectedBatch: (ids: string[], selected: boolean) => void;
  onRemove: (id: string) => void;
  onReExtract: (id: string) => void;
  onReExtractSelected: () => void;
  onCancel: (id: string) => void;
  onSetSkipSynthesis: (id: string, skip: boolean) => void;
  onFilesAdded: () => void;
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

  const selectedCount = files.filter((f) => f.selected).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const noneSelected = selectedCount === 0;

  function chapterCountForFile(fileIndex: number) {
    return chapters.filter((ch) => ch.sourceFileIndex === fileIndex).length;
  }

  function handleCheckboxClick(file: BookFileRow, index: number, e: React.MouseEvent) {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const ids = files.slice(start, end + 1).map((f) => f.id);
      onSetSelectedBatch(ids, !file.selected);
    } else {
      onSetSelected(file.id, !file.selected);
    }
    setLastClickedIndex(index);
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-(--text-secondary)">Source files</h2>
        <span className="text-sm text-(--text-muted)">{selectedCount} of {files.length} selected</span>
      </div>

      <div className="flex gap-2 mb-2">
        <button
          onClick={onReExtractSelected}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? "Select files to re-extract" : undefined}
          className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-xs font-medium hover:bg-(--border) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Re-extract selected ({selectedCount})
        </button>
        <AddFilesButton bookId={bookId} onFilesAdded={onFilesAdded} />
      </div>

      <div className="overflow-hidden rounded-lg border border-(--border)">
        <table className="min-w-full divide-y divide-(--divide)">
          <thead className="bg-(--bg-subtle)">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && !noneSelected; }}
                  onChange={() => onSetAllSelected(!allSelected)}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-(--text-muted) uppercase">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-(--text-muted) uppercase">Filename</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-(--text-muted) uppercase">Status</th>
              <th className="px-3 py-2 text-center text-xs font-medium text-(--text-muted) uppercase" title="Skip synthesis — extract only, defer audio generation">Skip synth</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-(--text-muted) uppercase">Chapters</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-(--text-muted) uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
            {files.map((file, i) => (
              <tr key={file.id} className="hover:bg-(--bg-card-hover)">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={file.selected}
                    onClick={(e) => handleCheckboxClick(file, i, e)}
                    readOnly
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2 text-xs font-mono text-(--text-muted)">{file.index + 1}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewFileId(file.id)}
                      className="shrink-0 h-6 w-6 rounded bg-red-50 flex items-center justify-center hover:bg-red-100 transition-colors cursor-pointer"
                      title="Preview PDF"
                    >
                      <span className="text-red-600 text-[8px] font-bold">PDF</span>
                    </button>
                    <span className="text-sm text-(--text-primary) truncate">{file.filename}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-medium ${
                    file.status === "done" ? "text-green-600" :
                    file.status === "failed" ? "text-red-600" :
                    file.status === "extracting" ? "text-blue-600" :
                    "text-(--text-muted)"
                  }`}>
                    {file.status}
                    {file.status === "extracting" && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 ml-1.5 animate-pulse" />
                    )}
                  </span>
                  {file.error && (
                    <span className="ml-2 text-xs text-red-500 truncate" title={file.error}>
                      {file.error.length > 30 ? file.error.slice(0, 30) + "..." : file.error}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={file.skipSynthesis}
                    onChange={() => onSetSkipSynthesis(file.id, !file.skipSynthesis)}
                    title={file.skipSynthesis ? "Chapters will be extracted only — click to enable auto-synthesis" : "Chapters will auto-synthesize after extraction — click to extract only"}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-(--text-tertiary)">
                  {chapterCountForFile(file.index)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {/* Cancel */}
                    <button
                      onClick={() => onCancel(file.id)}
                      disabled={file.status !== "extracting" && file.status !== "pending"}
                      title={file.status !== "extracting" && file.status !== "pending" ? "File is not extracting" : "Cancel extraction"}
                      className="p-1 rounded text-amber-600 hover:bg-amber-50 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM6 6h4v4H6V6z"/>
                      </svg>
                    </button>
                    {/* Re-extract */}
                    <button
                      onClick={() => onReExtract(file.id)}
                      disabled={file.status !== "done" && file.status !== "failed"}
                      title={
                        file.status === "extracting" ? "Wait for extraction to finish" :
                        file.status === "pending" ? "File hasn't been extracted yet" :
                        "Re-extract this file"
                      }
                      className="p-1 rounded text-blue-600 hover:bg-(--bg-selected) disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36A.25.25 0 0111.534 7zM.534 9h3.932a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9z"/>
                        <path d="M8 3a5 5 0 00-4.546 2.914.5.5 0 01-.908-.418A6 6 0 0114 8a.5.5 0 01-1 0 5 5 0 00-5-5zM2.5 8a.5.5 0 01.5.5A5 5 0 0012.546 11.086a.5.5 0 11.908.418A6 6 0 012 8.5a.5.5 0 01.5-.5z"/>
                      </svg>
                    </button>
                    {/* Remove */}
                    <button
                      onClick={() => {
                        const count = chapterCountForFile(file.index);
                        if (confirm(`Remove "${file.filename}" and its ${count} chapter(s)?`)) {
                          onRemove(file.id);
                        }
                      }}
                      disabled={file.status === "extracting"}
                      title={file.status === "extracting" ? "Cannot remove while extracting" : "Remove this file and its chapters"}
                      className="p-1 rounded text-red-500 hover:bg-red-50 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.75 1a.75.75 0 00-.75.75v.5H2.5a.75.75 0 000 1.5h.31l.69 9.112A1.75 1.75 0 005.246 14.5h5.508a1.75 1.75 0 001.746-1.638L13.19 3.75h.31a.75.75 0 000-1.5H11V1.75a.75.75 0 00-.75-.75h-4.5zM6.5 2.25v-.5h3v.5h-3zM4.32 3.75h7.36l-.68 9.04a.25.25 0 01-.249.21H5.249a.25.25 0 01-.249-.21L4.32 3.75z"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewFileId && (
        <PdfPreviewModal
          fileId={previewFileId}
          filename={files.find((f) => f.id === previewFileId)?.filename}
          onClose={() => setPreviewFileId(null)}
        />
      )}
    </div>
  );
}

function AddFilesButton({
  bookId,
  onFilesAdded,
}: {
  bookId: string;
  onFilesAdded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFiles(fileList: FileList) {
    const pdfs = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (const file of pdfs) {
        formData.append("file", file);
      }
      const res = await fetch(`/upload/${bookId}`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      onFilesAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
          }
          e.target.value = "";
        }}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-xs font-medium hover:bg-(--border) disabled:opacity-50"
      >
        {isUploading ? "Adding..." : "Add files"}
      </button>
    </>
  );
}

// --- Formatting helpers ---

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

function EditableTitle({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(title);
  }, [title]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function save() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    } else {
      setValue(title);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(title); setEditing(false); }
        }}
        className="text-2xl font-bold text-(--text-primary) bg-transparent border-b-2 border-blue-500 outline-none w-full"
      />
    );
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      className="text-2xl font-bold text-(--text-primary) cursor-pointer hover:text-blue-700"
      title="Click to rename"
    >
      {title}
    </h1>
  );
}

function formatLogTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
