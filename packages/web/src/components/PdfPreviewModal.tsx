export function PdfPreviewModal({
  fileId,
  page,
  filename,
  onClose,
}: {
  fileId: string;
  page?: number;
  filename?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border)">
          <span className="text-sm font-medium text-(--text-primary)">
            {filename}
            {page ? <span className="text-(--text-muted)"> — page {page}</span> : null}
          </span>
          <button
            onClick={onClose}
            className="text-(--text-faint) hover:text-(--text-tertiary) p-1"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        {/* Keyed by page so the browser's PDF viewer re-navigates — hash-only changes are ignored. */}
        <iframe
          key={`${fileId}-${page ?? 0}`}
          src={`/pdf/${fileId}${page ? `#page=${page}` : ""}`}
          className="flex-1 w-full"
          title="PDF Preview"
        />
      </div>
    </div>
  );
}
