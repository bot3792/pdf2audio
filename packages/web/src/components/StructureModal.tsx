import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc.ts";
import { PdfPreviewModal } from "./PdfPreviewModal.tsx";

type ChapterProposal = {
  status: "running" | "done" | "failed";
  method: "llm" | "deterministic";
  detection?: "llm" | "numbered-headings" | "heading-levels";
  boundaries?: { fileIndex: number | null; blockIndex: number; title: string; page: number }[];
  error?: string;
  createdAt: string;
};

type StructureFile = {
  fileIndex: number | null;
  filename: string;
  missing: boolean;
  totalWords: number;
  totalPages: number;
  headings: {
    blockIndex: number;
    page: number;
    level: number | null;
    text: string;
    wordsBefore: number;
    isChapterStart: boolean;
  }[];
};

function boundaryKey(fileIndex: number | null, blockIndex: number) {
  return `${fileIndex ?? "legacy"}:${blockIndex}`;
}

export function StructureModal({
  bookId,
  isProcessing,
  chapterProposal,
  files,
  onClose,
  onChanged,
}: {
  bookId: string;
  isProcessing: boolean;
  chapterProposal: ChapterProposal | null;
  files?: { id: string; index: number; filename: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: structure, isLoading } = trpc.books.structure.useQuery({ id: bookId });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pdfPreview, setPdfPreview] = useState<{ fileId: string; page: number; filename?: string } | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !structure) return;
    initialized.current = true;
    const initial = new Set<string>();
    for (const file of structure.files) {
      for (const h of file.headings) {
        if (h.isChapterStart) initial.add(boundaryKey(file.fileIndex, h.blockIndex));
      }
    }
    setSelected(initial);
  }, [structure]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const proposeMutation = trpc.books.proposeChapters.useMutation({ onSuccess: onChanged });
  const applyMutation = trpc.books.applyChapterBoundaries.useMutation({
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const proposalRunning = chapterProposal?.status === "running";

  function toggle(fileIndex: number | null, blockIndex: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = boundaryKey(fileIndex, blockIndex);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function useProposal() {
    if (!chapterProposal?.boundaries) return;
    setSelected(new Set(chapterProposal.boundaries.map((b) => boundaryKey(b.fileIndex, b.blockIndex))));
  }

  function apply() {
    if (!structure) return;
    const boundaries = structure.files.flatMap((file) =>
      file.headings
        .filter((h) => selected.has(boundaryKey(file.fileIndex, h.blockIndex)))
        .map((h) => ({ fileIndex: file.fileIndex, blockIndex: h.blockIndex }))
    );
    if (boundaries.length === 0) return;
    if (!confirm(`Re-slice the book into ${boundaries.length} chapters? Existing chapters, audio, and assemblies will be deleted.`)) return;
    applyMutation.mutate({ id: bookId, boundaries });
  }

  function pdfFileFor(fileIndex: number | null) {
    return files?.find((f) => f.index === fileIndex) ?? (files?.length === 1 ? files[0] : undefined);
  }

  // Mirrors the server's >50-word Preface threshold in sliceChaptersAtIndices
  function previewFor(file: StructureFile) {
    const chosen = file.headings.filter((h) => selected.has(boundaryKey(file.fileIndex, h.blockIndex)));
    if (chosen.length === 0) {
      return [{ key: "full", title: "Full Text", pageStart: 1, pageEnd: file.totalPages, words: file.totalWords }];
    }
    const chapters = chosen.map((h, i) => {
      const next = chosen[i + 1];
      return {
        key: `${h.blockIndex}`,
        title: h.text,
        pageStart: h.page,
        pageEnd: next ? next.page : file.totalPages,
        words: (next ? next.wordsBefore : file.totalWords) - h.wordsBefore,
      };
    });
    if (chosen[0].wordsBefore > 50) {
      chapters.unshift({ key: "preface", title: "Preface", pageStart: 1, pageEnd: chosen[0].page, words: chosen[0].wordsBefore });
    }
    return chapters;
  }

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="structure-modal">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-(--bg-card) rounded-xl shadow-2xl w-[92vw] max-w-6xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-(--border)">
          <div>
            <h2 className="text-lg font-semibold text-(--text-primary)">Book structure</h2>
            <p className="text-xs text-(--text-muted) mt-0.5">
              Every heading found in the extraction output. Check the ones that start a chapter, then apply.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 text-(--text-faint) hover:text-(--text-tertiary) rounded">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {chapterProposal && chapterProposal.status !== "running" ? (
          <div
            className={`px-5 py-2 border-b border-(--border) text-sm flex items-center gap-3 ${
              chapterProposal.status === "failed" ? "bg-red-50 text-red-700" : "bg-(--bg-subtle) text-(--text-secondary)"
            }`}
            data-testid="proposal-banner"
          >
            {chapterProposal.status === "done" ? (
              <>
                <span>
                  Proposal ready: {chapterProposal.boundaries?.length ?? 0} boundaries
                  {chapterProposal.detection ? ` (${chapterProposal.detection})` : ""}
                </span>
                <button
                  onClick={useProposal}
                  className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                  data-testid="use-proposal"
                >
                  Use proposal
                </button>
              </>
            ) : (
              <span>Proposal failed: {chapterProposal.error}</span>
            )}
          </div>
        ) : null}

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 border-r border-(--border)">
            {isLoading ? (
              <p className="text-sm text-(--text-muted)">Loading structure...</p>
            ) : (
              structure?.files.map((file) => (
                <div key={file.fileIndex ?? "legacy"} className="mb-4">
                  {structure.files.length > 1 || file.missing ? (
                    <h3 className="text-xs font-medium text-(--text-muted) uppercase tracking-wider mb-2">
                      {file.filename}
                      {file.missing ? " — extraction output missing" : ""}
                    </h3>
                  ) : null}
                  {file.headings.map((h) => {
                    const key = boundaryKey(file.fileIndex, h.blockIndex);
                    const pdfFile = pdfFileFor(file.fileIndex);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm hover:bg-(--bg-subtle) ${
                          selected.has(key) ? "bg-blue-50 dark:bg-blue-950/40" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(file.fileIndex, h.blockIndex)}
                          className="rounded shrink-0"
                        />
                        {h.level ? (
                          <span className="shrink-0 text-[10px] font-mono px-1 rounded bg-(--bg-subtle) text-(--text-faint)">
                            H{h.level}
                          </span>
                        ) : null}
                        <span className="flex-1 truncate text-(--text-primary)" title={h.text}>
                          {h.text}
                        </span>
                        {pdfFile ? (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setPdfPreview({ fileId: pdfFile.id, page: h.page, filename: pdfFile.filename });
                            }}
                            className="shrink-0 text-xs text-blue-600 hover:text-blue-800 tabular-nums"
                            title="Open the source PDF at this page"
                          >
                            p.{h.page}
                          </button>
                        ) : (
                          <span className="shrink-0 text-xs text-(--text-muted) tabular-nums">p.{h.page}</span>
                        )}
                      </label>
                    );
                  })}
                  {!file.missing && file.headings.length === 0 ? (
                    <p className="text-sm text-(--text-muted)">No headings found in this file.</p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="w-96 shrink-0 overflow-y-auto p-4 bg-(--bg-subtle)/50">
            <h3 className="text-xs font-medium text-(--text-muted) uppercase tracking-wider mb-2">
              Resulting chapters
            </h3>
            {structure?.files.map((file) => (
              <div key={file.fileIndex ?? "legacy"} className="mb-3">
                {structure.files.length > 1 ? (
                  <p className="text-xs text-(--text-faint) mb-1 truncate">{file.filename}</p>
                ) : null}
                {previewFor(file).map((ch, i) => (
                  <div key={ch.key} className="flex items-baseline gap-2 py-0.5 text-sm">
                    <span className="shrink-0 text-xs font-mono text-(--text-faint) w-6 text-right">{i + 1}.</span>
                    <span className="flex-1 truncate text-(--text-secondary)" title={ch.title}>
                      {ch.title}
                    </span>
                    <span className="shrink-0 text-xs text-(--text-muted) tabular-nums">
                      p.{ch.pageStart}–{ch.pageEnd} · {ch.words.toLocaleString()}w
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 border-t border-(--border)">
          <button
            onClick={() => proposeMutation.mutate({ id: bookId, method: "deterministic" })}
            disabled={proposalRunning || proposeMutation.isPending}
            className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-sm font-medium hover:bg-(--border) disabled:opacity-50"
            title="Re-run the heading heuristics and preview the result before committing"
          >
            Propose (heuristic)
          </button>
          <button
            onClick={() => proposeMutation.mutate({ id: bookId, method: "llm" })}
            disabled={proposalRunning || proposeMutation.isPending}
            className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-sm font-medium hover:bg-(--border) disabled:opacity-50"
            title="Ask the local LLM for chapter boundaries and preview the result before committing (takes minutes)"
          >
            Propose (LLM)
          </button>
          {proposalRunning ? (
            <span className="text-sm text-blue-600" data-testid="proposal-running">
              Proposal running{chapterProposal?.method === "llm" ? " (LLM, may take minutes)" : ""}...
            </span>
          ) : null}
          {applyMutation.error || proposeMutation.error ? (
            <span className="text-sm text-red-600 truncate">
              {(applyMutation.error ?? proposeMutation.error)?.message}
            </span>
          ) : null}
          <div className="flex-1" />
          <span className="text-sm text-(--text-muted)">{selectedCount} boundaries</span>
          <button
            onClick={apply}
            disabled={selectedCount === 0 || isProcessing || applyMutation.isPending}
            title={
              selectedCount === 0 ? "Check at least one heading" :
              isProcessing ? "Wait for processing to finish" :
              "Delete existing chapters and re-slice at the checked boundaries"
            }
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="apply-boundaries"
          >
            Apply boundaries
          </button>
        </div>
      </div>

      {pdfPreview ? (
        <PdfPreviewModal
          fileId={pdfPreview.fileId}
          page={pdfPreview.page}
          filename={pdfPreview.filename}
          onClose={() => setPdfPreview(null)}
        />
      ) : null}
    </div>
  );
}
