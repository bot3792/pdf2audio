import { useState, useRef, useCallback, type DragEvent } from "react";
import { VoicePicker } from "./VoicePicker.tsx";
import { SpeedSlider } from "./SpeedSlider.tsx";
import { getVoiceById, voiceSupportsSpeedControl } from "../lib/voices.ts";

type UploadZoneProps = {
  onUploadComplete: () => void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [voice, setVoice] = useState("kokoro:af_heart");
  const [speed, setSpeed] = useState(1.0);
  const [forceOcr, setForceOcr] = useState(false);
  const [llmChapterDetection, setLlmChapterDetection] = useState(false);
  // Extraction-only is the default: most books get read, translated, or exported before (if ever) synthesized
  const [autoSynthesize, setAutoSynthesize] = useState(false);
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

  async function upload() {
    if (stagedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      for (const file of stagedFiles) {
        formData.append("file", file);
      }
      if (customTitle.trim()) {
        formData.append("title", customTitle.trim());
      }
      formData.append("voice", voice);
      formData.append("speed", String(voiceSupportsSpeedControl(voice) ? speed : 1.0));
      formData.append("forceOcr", String(forceOcr));
      formData.append("llmChapterDetection", String(llmChapterDetection));
      formData.append("skipSynthesis", String(!autoSynthesize));

      const res = await fetch("/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      setStagedFiles([]);
      setCustomTitle("");
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      stageFiles(e.dataTransfer.files);
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
            <p className="text-lg font-medium text-(--text-secondary)">Drop PDF files here</p>
            <p className="text-sm text-(--text-muted) mt-1">or click to browse</p>
          </div>
        )}
      </div>

      {isMultiFile && (
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
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Only needed for scanned PDFs without selectable text">
              <input type="checkbox" checked={forceOcr} onChange={(e) => setForceOcr(e.target.checked)} className="rounded" />
              Force OCR
            </label>
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Uses DeepSeek to identify chapter boundaries from the table of contents">
              <input type="checkbox" checked={llmChapterDetection} onChange={(e) => setLlmChapterDetection(e.target.checked)} className="rounded" />
              LLM chapter detection
            </label>
            <label className="flex items-center gap-2 text-sm text-(--text-secondary)" title="Start synthesizing every chapter right after extraction. Off by default — you can read, translate, export, or synthesize selected chapters from the book page anytime.">
              <input type="checkbox" checked={autoSynthesize} onChange={(e) => setAutoSynthesize(e.target.checked)} className="rounded" />
              Synthesize audio after extraction
            </label>
          </div>

          {autoSynthesize && (
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
            {isUploading ? "Uploading..." : autoSynthesize ? "Extract & synthesize" : "Extract"}
            {isMultiFile ? ` (${stagedFiles.length} files)` : ""}
          </button>
        </>
      )}

      {error && (
        <p className="text-red-600 text-sm">{error}</p>
      )}
    </div>
  );
}
