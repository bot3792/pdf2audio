import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { formatBytes, formatRelativeTime } from "../lib/format.ts";
import { loadBookSort, saveBookSort, sortBooks, type BookSortDir, type BookSortKey } from "../lib/book-sort.ts";
import { DigestModal } from "./DigestModal.tsx";

type SortKey = BookSortKey;
type SortDir = BookSortDir;

function ActivityPill({ label, color, pulse = true }: { label: string; color: string; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  );
}

function SortableTh({
  label,
  sortKey,
  align = "left",
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className={`px-4 py-3 text-${align} text-xs font-medium text-(--text-muted) uppercase tracking-wider`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-(--text-secondary) ${active ? "text-(--text-secondary)" : ""}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className={`text-[9px] ${active ? "" : "invisible"}`}>{dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

export function BookList() {
  const utils = trpc.useUtils();
  const { data: books, isLoading } = trpc.books.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [showDigest, setShowDigest] = useState(false);
  const deleteManyMutation = trpc.books.deleteMany.useMutation({
    onSuccess: () => {
      setSelectedIds(new Set());
      utils.books.list.invalidate();
    },
  });

  const [sortKey, setSortKey] = useState<SortKey>(() => loadBookSort().key);
  const [sortDir, setSortDir] = useState<SortDir>(() => loadBookSort().dir);

  function handleSort(key: SortKey) {
    const dir = key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : key === "title" ? "asc" : "desc";
    setSortKey(key);
    setSortDir(dir);
    saveBookSort(key, dir);
  }

  if (isLoading) {
    return <p className="text-(--text-muted) py-4">Loading...</p>;
  }

  if (!books || books.length === 0) {
    return <p className="text-(--text-muted) py-4">No books yet. Upload a PDF to get started.</p>;
  }

  const sorted = sortBooks(books, sortKey, sortDir);

  // Prune ids of books deleted elsewhere so counts never lie
  const selectedBooks = sorted.filter((b) => selectedIds.has(b.id));
  const selectedCount = selectedBooks.length;
  const allSelected = selectedCount === sorted.length && sorted.length > 0;

  function handleCheckboxClick(bookId: string, index: number, e: React.MouseEvent) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const select = !prev.has(bookId);
      if (e.shiftKey && lastClickedIndex !== null) {
        for (const b of sorted.slice(Math.min(lastClickedIndex, index), Math.max(lastClickedIndex, index) + 1)) {
          if (select) next.add(b.id);
          else next.delete(b.id);
        }
      } else if (select) next.add(bookId);
      else next.delete(bookId);
      return next;
    });
    setLastClickedIndex(index);
  }

  function deleteSelected() {
    const titles = selectedBooks.slice(0, 5).map((b) => `"${b.title}"`).join(", ");
    const suffix = selectedCount > 5 ? `, and ${selectedCount - 5} more` : "";
    if (!confirm(`Delete ${selectedCount} book(s) with all their chapters, audio, and files?\n\n${titles}${suffix}`)) return;
    deleteManyMutation.mutate({ ids: selectedBooks.map((b) => b.id) });
  }

  const th = (label: string, key: SortKey, align?: "left" | "right") => (
    <SortableTh label={label} sortKey={key} align={align} active={sortKey === key} dir={sortDir} onSort={handleSort} />
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowDigest(true)}
          disabled={selectedCount < 2}
          title={selectedCount < 2 ? "Select at least 2 books with the checkboxes" : "Create a digest book — one AI summary chapter per selected book, ready to listen to"}
          className="px-3 py-1.5 bg-sky-600 text-white rounded-md text-xs font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="create-digest"
        >
          Create digest ({selectedCount})
        </button>
        <button
          onClick={deleteSelected}
          disabled={selectedCount === 0 || deleteManyMutation.isPending}
          title={selectedCount === 0 ? "Select books to delete with the checkboxes" : "Delete the selected books with all their chapters, audio, and files"}
          className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="delete-selected-books"
        >
          {deleteManyMutation.isPending ? "Deleting..." : `Delete selected (${selectedCount})`}
        </button>
        {deleteManyMutation.error && (
          <span className="text-sm text-red-600">{deleteManyMutation.error.message}</span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-(--border)">
      <table className="w-full min-w-[72rem] divide-y divide-(--divide)">
        <thead className="bg-(--bg-subtle)">
          <tr>
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = !allSelected && selectedCount > 0; }}
                onChange={() => setSelectedIds(allSelected ? new Set() : new Set(sorted.map((b) => b.id)))}
                title={allSelected ? "Deselect all" : "Select all"}
                className="rounded"
              />
            </th>
            {th("Title", "title")}
            {th("Chapters", "chapters", "right")}
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Activity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Languages</th>
            {th("Outputs", "outputs")}
            {th("Size", "size", "right")}
            {th("Created", "created", "right")}
            {th("Last activity", "lastActivity", "right")}
          </tr>
        </thead>
        <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
          {sorted.map((book) => {
            const totalFailures =
              book.failures.files + book.failures.chapters + book.failures.translations + book.failures.cleanup;
            const failureDetail = [
              book.failures.files > 0 ? `${book.failures.files} file(s)` : null,
              book.failures.chapters > 0 ? `${book.failures.chapters} chapter(s)` : null,
              book.failures.translations > 0 ? `${book.failures.translations} translation(s)` : null,
              book.failures.cleanup > 0 ? `${book.failures.cleanup} cleanup(s)` : null,
            ].filter(Boolean).join(", ");
            const idle =
              !book.activity.extracting && !book.activity.assembling && !book.activity.aiNote && !book.activity.digest &&
              book.activity.synthesizing === 0 && book.activity.translating === 0 && book.activity.cleaning === 0;
            const outputParts = [
              book.outputs.assemblies > 0 ? `${book.outputs.assemblies} MP3` : null,
              book.outputs.pdfs > 0 ? `${book.outputs.pdfs} PDF` : null,
              book.outputs.epubs > 0 ? `${book.outputs.epubs} EPUB` : null,
            ].filter(Boolean);

            return (
              <tr key={book.id} className={`hover:bg-(--bg-card-hover) ${selectedIds.has(book.id) ? "bg-(--bg-selected)" : ""}`}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(book.id)}
                    onClick={(e) => handleCheckboxClick(book.id, sorted.indexOf(book), e)}
                    readOnly
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 max-w-md">
                  <Link to={`/books/${book.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {book.title}
                  </Link>
                  {book.kind === "digest" && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 align-middle" title="Digest — AI summary chapters from other books">
                      digest
                    </span>
                  )}
                  {book.skipSynthesis && book.kind === "pdf" && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-(--bg-subtle) text-(--text-muted) align-middle" title="Reader mode — extraction only, audio on demand">
                      reader
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm tabular-nums text-(--text-secondary)">{book.chapterCount}</span>
                  {book.chaptersWithAudio > 0 && (
                    <span className="block text-[11px] text-(--text-faint) tabular-nums" title={`${book.chaptersWithAudio} chapters have audio`}>
                      {book.chaptersWithAudio} audio
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {book.activity.extracting && (
                      <ActivityPill label="extracting" color="bg-(--badge-extracting-bg) text-(--badge-extracting-text)" />
                    )}
                    {book.activity.synthesizing > 0 && (
                      <ActivityPill label={`synthesizing ${book.activity.synthesizing}`} color="bg-(--badge-synthesizing-bg) text-(--badge-synthesizing-text)" />
                    )}
                    {book.activity.translating > 0 && (
                      <ActivityPill label={`translating ${book.activity.translating}`} color="bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300" />
                    )}
                    {book.activity.cleaning > 0 && (
                      <ActivityPill label={`cleaning ${book.activity.cleaning}`} color="bg-(--badge-normalizing-bg) text-(--badge-normalizing-text)" />
                    )}
                    {book.activity.assembling && (
                      <ActivityPill label="assembling" color="bg-(--badge-assembling-bg) text-(--badge-assembling-text)" />
                    )}
                    {book.activity.aiNote && (
                      <ActivityPill label="AI note" color="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" />
                    )}
                    {book.activity.digest && (
                      <ActivityPill label="digesting" color="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" />
                    )}
                    {totalFailures > 0 && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-(--badge-failed-bg) text-(--badge-failed-text)"
                        title={`Failed: ${failureDetail}${book.error ? ` — ${book.error}` : ""}`}
                      >
                        {totalFailures} failed
                      </span>
                    )}
                    {idle && totalFailures === 0 && <span className="text-xs text-(--text-faint)">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {book.languages.length === 0 ? (
                    <span className="text-xs text-(--text-faint)">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {book.languages.map((l) => (
                        <span
                          key={l.language}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border border-(--border) text-(--text-secondary)"
                          title={`${l.done} of ${book.chapterCount} chapters translated to ${l.language}`}
                        >
                          {l.language} {l.done}/{book.chapterCount}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-(--text-tertiary)">
                  {outputParts.length === 0 ? <span className="text-xs text-(--text-faint)">—</span> : outputParts.join(" · ")}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-(--text-tertiary)">
                  {formatBytes(book.sizeBytes)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-(--text-tertiary)">
                  {new Date(book.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right text-sm text-(--text-tertiary)" title={new Date(book.lastActivityAt).toLocaleString()}>
                  {formatRelativeTime(book.lastActivityAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {showDigest && (
        <DigestModal
          sourceBooks={selectedBooks.map((b) => ({ id: b.id, title: b.title }))}
          onClose={() => setShowDigest(false)}
        />
      )}
    </div>
  );
}
