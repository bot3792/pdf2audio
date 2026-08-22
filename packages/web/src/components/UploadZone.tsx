import { useState, useRef, useCallback, type DragEvent } from "react";
import { VoicePicker } from "./VoicePicker.tsx";
import { SpeedSlider } from "./SpeedSlider.tsx";
import { getVoiceById, voiceSupportsSpeedControl, getVoiceLabel } from "../lib/voices.ts";
import { AI_MODELS, AI_PRESETS, type AiModelKey } from "../lib/ai-presets.ts";
import { profileHeaders } from "../lib/profile.ts";
import { AfterExtractChoice } from "./AfterExtractChoice.tsx";

type UploadZoneProps = {
  onUploadComplete: () => void;
  folderId?: string | null;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({ onUploadComplete, folderId = null }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [voice, setVoice] = useState("kokoro:af_heart");
  const [speed, setSpeed] = useState(1.0);
  const [forceOcr, setForceOcr] = useState(false);
  // Raw-text-only is the default: pdftotext lands in seconds, marker takes minutes — extract chapters later from the book page
  const [fullExtract, setFullExtract] = useState(false);
  const [llmChapterDetection, setLlmChapterDetection] = useState(false);
  const [autoSynthesize, setAutoSynthesize] = useState(false);
  const [separateBooks, setSeparateBooks] = useState(false);
  const [askAi, setAskAi] = useState(false);
  const [notePreset, setNotePreset] = useState<string>("summarize");
  const [notePrompt, setNotePrompt] = useState<string>(AI_PRESETS[0].prompt("book"));
  const [noteModel, setNoteModel] = useState<AiModelKey>("flash");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function stageFiles(fileList: FileList | File[]) {
    const newFiles: File[] = [];
    for (const file of fileList) {
      if (!file.name.toLowerCase().endsWith(".pdf")) continue;
      newFiles.push(file);
    }
    if (newFiles.length === 0) {
      setError("Only PDF files are supported");
      return;
    }
    setError(null);
    setStagedFiles((prev) => [...prev, ...newFiles]);
  }

  function removeFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const moveFile = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setStagedFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  function buildFormData(files: File[], title: string | null): FormData {
    const formData = new FormData();
    for (const file of files) {
      formData.append("file", file);
    }
    if (title) formData.append("title", title);
    formData.append("voice", voice);
    formData.append("speed", String(voiceSupportsSpeedControl(voice) ? speed : 1.0));
    formData.append("forceOcr", String(forceOcr));
    formData.append("fullExtract", String(fullExtract));
    formData.append("llmChapterDetection", String(fullExtract && llmChapterDetection));
    formData.append("skipSynthesis", String(!(fullExtract && autoSynthesize)));
    if (folderId) formData.append("folderId", folderId);
    if (askAi && notePrompt.trim()) {
      formData.append("notePrompt", notePrompt.trim());
      formData.append("noteModel", noteModel);
    }
    return formData;
  }

  async function postUpload(formData: FormData) {
    const res = await fetch("/upload", { method: "POST", body: formData, headers: profileHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${res.status})`);
    }
  }

  async function upload() {
    if (stagedFiles.length === 0) return;
    const asSeparateBooks = separateBooks && stagedFiles.length > 1;

    setIsUploading(true);
    setError(null);

    try {
      if (asSeparateBooks) {
        const failures: string[] = [];
        const succeeded = new Set<File>();
        for (const file of stagedFiles) {
          try {
            await postUpload(buildFormData([file], null));
            succeeded.add(file);
          } catch (err) {
            failures.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }
        if (failures.length > 0) {
          // Keep only the failed files staged so a retry doesn't duplicate books
          setStagedFiles((prev) => prev.filter((f) => !succeeded.has(f)));
          throw new Error(`${failures.length} of ${stagedFiles.length} uploads failed — ${failures.join("; ")}`);
        }
      } else {
        await postUpload(buildFormData(stagedFiles, customTitle.trim() || null));
      }

      setStagedFiles([]);
      setCustomTitle("");
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      onUploadComplete();
    } finally {
      setIsUploading(false);
    }
  }

  async function readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      return file.name.toLowerCase().endsWith(".pdf") ? [file] : [];
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const entries: FileSystemEntry[] = [];
      // readEntries returns batches of ≤100; keep reading until an empty batch
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        entries.push(...batch);
      }
      const nested = await Promise.all(entries.map(readEntryFiles));
      return nested.flat();
    }
    return [];
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);

    // Entries must be captured synchronously — the DataTransfer is dead after the first await
    const entries = [...e.dataTransfer.items]
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter((entry): entry is FileSystemEntry => entry !== null);

    if (!entries.some((entry) => entry.isDirectory)) {
      if (e.dataTransfer.files.length > 0) stageFiles(e.dataTransfer.files);
      return;
    }

    try {
      const collected = (await Promise.all(entries.map(readEntryFiles))).flat();
      collected.sort((a, b) => a.name.localeCompare(b.name));
      if (collected.length === 0) {
        setError("No PDF files found in the dropped folder");
        return;
      }
      // A folder is usually a collection of separate books, not volumes of one
      if (collected.length > 1 && stagedFiles.length === 0) setSeparateBooks(true);
      stageFiles(collected);
    } catch {
      setError("Could not read the dropped folder");
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      stageFiles(e.target.files);
    }
    e.target.value = "";
  }

  function handleRowDragStart(e: React.DragEvent, index: number) {
    e.dataTransfer.effectAllowed = "move";
    setDragIndex(index);
  }

  function handleRowDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }

  function handleRowDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex !== null) {
      moveFile(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleRowDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  const hasFiles = stagedFiles.length > 0;
  const isMultiFile = stagedFiles.length > 1;
  const selectedVoice = getVoiceById(voice);
  const speedEnabled = voiceSupportsSpeedControl(voice);

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg text-center transition-colors
          ${hasFiles ? "p-4" : "p-12"}
          ${isDragging ? "border-blue-500 bg-(--bg-drag)" : hasFiles ? "border-(--border-input) bg-(--bg-card)" : "border-(--border-input) hover:border-(--text-faint) bg-(--bg-subtle)"}
          ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        {hasFiles ? (
          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
            {stagedFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                draggable
                onDragStart={(e) => handleRowDragStart(e, index)}
                onDragOver={(e) => handleRowDragOver(e, index)}
                onDrop={(e) => handleRowDrop(e, index)}
                onDragEnd={handleRowDragEnd}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-md transition-colors
                  ${dragIndex === index ? "opacity-40" : ""}
                  ${dragOverIndex === index && dragIndex !== index ? "bg-(--bg-drag) border border-blue-400 border-dashed" : "hover:bg-(--bg-subtle)"}
                `}
              >
                <span className="cursor-grab text-(--text-faint) select-none" title="Drag to reorder">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="text-xs font-mono text-(--text-muted) w-5 text-right shrink-0">{index + 1}</span>
                <div className="shrink-0 h-8 w-8 rounded bg-red-50 flex items-center justify-center">
                  <span className="text-red-600 text-[10px] font-bold">PDF</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-(--text-primary) truncate">{file.name}</p>
                  <p className="text-xs text-(--text-muted)">{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="shrink-0 p-1 text-(--text-faint) hover:text-(--text-tertiary) rounded"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 text-xs text-(--text-muted) hover:text-(--text-secondary) border border-dashed border-(--border-input) rounded-md transition-colors"
            >
              + Add more files
            </button>
          </div>
        ) : (
          <div>
            <p className="text-lg font-medium text-(--text-secondary)">Drop PDF files or a folder here</p>
            <p className="text-sm text-(--text-muted) mt-1">or click to browse — folders are scanned recursively for PDFs</p>
          </div>
        )}
      </div>

      {isMultiFile && (
        <div className="flex gap-6" data-testid="upload-mode">
          <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="All files become one book — use for multi-volume works; drag rows to set the volume order">
            <input type="radio" name="upload-mode" checked={!separateBooks} onChange={() => setSeparateBooks(false)} />
            One book (volumes)
          </label>
          <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Each PDF becomes its own book, titled after its filename">
            <input type="radio" name="upload-mode" checked={separateBooks} onChange={() => setSeparateBooks(true)} />
            Separate books
          </label>
        </div>
      )}

      {isMultiFile && !separateBooks && (
        <div>
          <label className="block text-sm text-(--text-secondary) mb-1">Book title</label>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={stagedFiles[0]?.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " ")}
            className="w-full px-3 py-2 text-sm border border-(--border-input) rounded-md bg-(--bg-card) text-(--text-primary) placeholder:text-(--text-faint)"
          />
        </div>
      )}

      {hasFiles && (
        <>
          <div className="flex gap-6 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Run the slow Marker extraction right away to detect chapters (takes minutes per book). Off by default — raw text is always extracted in seconds, and you can extract chapters later from the book page.">
              <input type="checkbox" checked={fullExtract} onChange={(e) => setFullExtract(e.target.checked)} className="rounded" data-testid="full-extract" />
              Extract chapters now
            </label>
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Only needed for scanned PDFs without selectable text. Saved on the book — also applies when you extract chapters later.">
              <input type="checkbox" checked={forceOcr} onChange={(e) => setForceOcr(e.target.checked)} className="rounded" />
              Force OCR
            </label>
            {fullExtract && (
              <>
                <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Uses DeepSeek to identify chapter boundaries from the table of contents">
                  <input type="checkbox" checked={llmChapterDetection} onChange={(e) => setLlmChapterDetection(e.target.checked)} className="rounded" />
                  LLM chapter detection
                </label>
                <AfterExtractChoice
                  autoSynthesize={autoSynthesize}
                  onChange={setAutoSynthesize}
                  voiceLabel={getVoiceLabel(voice)}
                />
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title={`Run an AI prompt against ${isMultiFile && separateBooks ? "each book's" : "the book's"} raw text right after upload — the answer is saved to the book's notes`}>
              <input type="checkbox" checked={askAi} onChange={(e) => setAskAi(e.target.checked)} className="rounded" data-testid="upload-ask-ai" />
              Ask AI after upload
            </label>
          </div>

          {askAi && (
            <div className="rounded-lg border border-(--border) bg-(--bg-subtle) p-3 space-y-2" data-testid="upload-ai-section">
              <div className="flex flex-wrap gap-1.5">
                {AI_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setNotePreset(p.key);
                      setNotePrompt(p.prompt("book"));
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                      notePreset === p.key
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-(--border) text-(--text-secondary) hover:bg-(--bg-card)"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <div className="inline-flex rounded-md border border-(--border) p-0.5 gap-0.5 ml-auto">
                  {AI_MODELS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setNoteModel(m.key)}
                      title={m.hint}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${
                        noteModel === m.key
                          ? "bg-(--bg-card) text-(--text-primary)"
                          : "text-(--text-muted) hover:text-(--text-secondary)"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={notePrompt}
                onChange={(e) => setNotePrompt(e.target.value)}
                rows={3}
                maxLength={4000}
                className="w-full resize-y rounded-md border border-(--border-input) bg-(--bg-card) p-2.5 text-sm text-(--text-primary) leading-relaxed focus:outline-none focus:border-blue-500"
                placeholder="What should the AI answer about each uploaded book?"
                data-testid="upload-ai-prompt"
              />
              <p className="text-xs text-(--text-faint)">
                Runs against the raw text of {isMultiFile && separateBooks ? "each book" : "the whole book"} once it's extracted (seconds after upload). The answer lands in the book's notes.
              </p>
            </div>
          )}

          {fullExtract && autoSynthesize && (
            <>
              <div className="flex gap-6 items-end">
                <VoicePicker value={voice} onChange={setVoice} />
                <SpeedSlider value={speed} onChange={setSpeed} disabled={!speedEnabled} />
              </div>
              {!speedEnabled && selectedVoice && (
                <p className="text-xs text-(--text-muted)">{selectedVoice.label} uses a fixed speed in v1.</p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={upload}
            disabled={isUploading}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : !fullExtract ? "Upload" : autoSynthesize ? "Extract & synthesize" : "Extract"}
            {isMultiFile ? ` (${stagedFiles.length} ${separateBooks ? "books" : "files"})` : ""}
          </button>
        </>
      )}

      {error && (
        <p className="text-red-600 text-sm">{error}</p>
      )}
    </div>
  );
}
