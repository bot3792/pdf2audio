import { useState, useRef } from "react";
import { PdfPreviewModal } from "./PdfPreviewModal.tsx";

export type BookFileRow = {
  id: string;
  index: number;
  filename: string;
  status: string;
  selected: boolean;
  skipSynthesis: boolean;
  rawWords?: number | null;
  error: string | null;
};

type ChapterRowForFiles = {
  sourceFileIndex: number | null;
  [key: string]: unknown;
};

export function BookFilesSection({
  files,
  chapters,
  bookId,
  isProcessing,
  forceOcr,
  llmChapterDetection,
  onUpdateExtractionSettings,
  onSetSelected,
  onSetAllSelected,
  onSetSelectedBatch,
  onRemove,
  onReExtract,
  onReExtractSelected,
  onReExtractBook,
  onRedetectChapters,
  onCancelExtraction,
  onCancel,
  onSetSkipSynthesis,
  onFilesAdded,
}: {
  files: BookFileRow[];
  chapters: ChapterRowForFiles[];
  bookId: string;
  isProcessing: boolean;
  forceOcr: boolean;
  llmChapterDetection: boolean;
  onUpdateExtractionSettings: (settings: { forceOcr?: boolean; llmChapterDetection?: boolean }) => void;
  onSetSelected: (id: string, selected: boolean) => void;
  onSetAllSelected: (selected: boolean) => void;
  onSetSelectedBatch: (ids: string[], selected: boolean) => void;
  onRemove: (id: string) => void;
  onReExtract: (id: string) => void;
  onReExtractSelected: () => void;
  onReExtractBook: () => void;
  onRedetectChapters: () => void;
  onCancelExtraction: () => void;
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

  const extractingCount = files.filter((f) => f.status === "extracting" || f.status === "pending").length;

  return (
    <section className={`relative overflow-hidden mb-6 rounded-xl border border-(--border) border-t-2 bg-(--bg-card) p-4 ${
      extractingCount > 0 ? "border-t-blue-500" : "border-t-amber-400/80"
    }`}>
      {extractingCount > 0 && (
        <>
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
            <div className="h-full w-1/4 bg-blue-500 animate-[slide-indeterminate_1.4s_ease-in-out_infinite]" />
          </div>
          <div className="absolute inset-0 rounded-xl ring-2 ring-inset ring-blue-400/30 animate-pulse pointer-events-none" aria-hidden />
        </>
      )}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-(--text-secondary)">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mr-2">1 · Input</span>
            Source files
          </h2>
          {extractingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400" data-testid="extracting-indicator">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Extracting {extractingCount} file{extractingCount === 1 ? "" : "s"}...
            </span>
          )}
        </div>
        <span className="text-sm text-(--text-muted)">{selectedCount} of {files.length} selected</span>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <AddFilesButton bookId={bookId} onFilesAdded={onFilesAdded} />
        <button
          onClick={onReExtractSelected}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? "Select files to re-extract" : "Delete the selected files' chapters and run extraction again with the settings on the right"}
          className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-xs font-medium hover:bg-(--border) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Re-extract selected ({selectedCount})
        </button>
        <button
          onClick={onReExtractBook}
          disabled={isProcessing || chapters.length === 0}
          title={
            isProcessing ? "Wait for processing to finish" :
            chapters.length === 0 ? "Nothing extracted yet" :
            "Delete all chapters and re-extract every file with the settings on the right"
          }
          className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-xs font-medium hover:bg-(--border) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Re-extract entire book
        </button>
        <button
          onClick={onRedetectChapters}
          disabled={isProcessing || chapters.length === 0}
          title={
            isProcessing ? "Wait for processing to finish" :
            chapters.length === 0 ? "Nothing extracted yet" :
            "Re-detect chapter boundaries from the existing extraction output — does not re-run OCR"
          }
          className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-xs font-medium hover:bg-(--border) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Re-detect chapters
        </button>
        <button
          onClick={onCancelExtraction}
          disabled={extractingCount === 0}
          title={
            extractingCount === 0
              ? "No files are being extracted"
              : `Stop the running extraction — ${extractingCount} file(s) will be marked as cancelled`
          }
          className="px-3 py-1.5 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="cancel-extraction"
        >
          Cancel extraction
        </button>

        <div className="flex-1" />

        <span className="text-xs text-(--text-faint) uppercase tracking-wider">Extraction settings</span>
        <label
          className="flex items-center gap-1.5 text-xs text-(--text-muted)"
          title="Only needed for scanned PDFs without selectable text. Applies to every extraction of this book, including per-file re-extracts. The original PDF is kept as-is — OCR output is stored as extracted text."
        >
          <input
            type="checkbox"
            checked={forceOcr}
            onChange={(e) => onUpdateExtractionSettings({ forceOcr: e.target.checked })}
            className="rounded"
          />
          Force OCR
        </label>
        <label
          className="flex items-center gap-1.5 text-xs text-(--text-muted)"
          title="Uses DeepSeek to pick chapter boundaries from the table of contents during extraction and re-detection. Applies to every extraction of this book."
        >
          <input
            type="checkbox"
            checked={llmChapterDetection}
            onChange={(e) => onUpdateExtractionSettings({ llmChapterDetection: e.target.checked })}
            className="rounded"
          />
          LLM chapters
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-(--border)">
        <table className="w-full min-w-[48rem] divide-y divide-(--divide)">
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
                    {file.status === "raw" ? "raw text" : file.status}
                    {file.status === "extracting" && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 ml-1.5 animate-pulse" />
                    )}
                  </span>
                  {file.rawWords != null && file.status === "raw" && (
                    <span className="ml-2 text-xs text-(--text-faint)" title="Words in the raw text layer">
                      {file.rawWords.toLocaleString()} words
                    </span>
                  )}
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
                      disabled={file.status !== "done" && file.status !== "failed" && file.status !== "raw"}
                      title={
                        file.status === "extracting" ? "Wait for extraction to finish" :
                        file.status === "pending" ? "File hasn't been extracted yet" :
                        file.status === "raw" ? "Extract chapters from this file" :
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
    </section>
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
