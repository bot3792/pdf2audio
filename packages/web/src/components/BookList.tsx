import { useState } from "react";
import { Link } from "react-router";
import type { RouterOutputs } from "../../../server/src/router.ts";
import { trpc } from "../trpc.ts";
import { formatBytes, formatRelativeTime } from "../lib/format.ts";

type BookRow = RouterOutputs["books"]["list"][number];

type SortKey = "title" | "chapters" | "outputs" | "size" | "created" | "lastActivity";
type SortDir = "asc" | "desc";

const SORT_VALUE: Record<SortKey, (b: BookRow) => string | number> = {
  title: (b) => b.title.toLowerCase(),
  chapters: (b) => b.chapterCount,
  outputs: (b) => b.outputs.assemblies + b.outputs.pdfs + b.outputs.epubs,
  size: (b) => b.sizeBytes,
  created: (b) => new Date(b.createdAt).getTime(),
  lastActivity: (b) => new Date(b.lastActivityAt).getTime(),
};

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
  const { data: books, isLoading } = trpc.books.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const [sortKey, setSortKey] = useState<SortKey>("lastActivity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return <p className="text-(--text-muted) py-4">Loading...</p>;
  }

  if (!books || books.length === 0) {
    return <p className="text-(--text-muted) py-4">No books yet. Upload a PDF to get started.</p>;
  }

  const sorted = [...books].sort((a, b) => {
    const va = SORT_VALUE[sortKey](a);
    const vb = SORT_VALUE[sortKey](b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const th = (label: string, key: SortKey, align?: "left" | "right") => (
    <SortableTh label={label} sortKey={key} align={align} active={sortKey === key} dir={sortDir} onSort={handleSort} />
  );

  return (
    <div className="overflow-hidden rounded-lg border border-(--border)">
      <table className="min-w-full divide-y divide-(--divide)">
        <thead className="bg-(--bg-subtle)">
          <tr>
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
              !book.activity.extracting && !book.activity.assembling &&
              book.activity.synthesizing === 0 && book.activity.translating === 0 && book.activity.cleaning === 0;
            const outputParts = [
              book.outputs.assemblies > 0 ? `${book.outputs.assemblies} MP3` : null,
              book.outputs.pdfs > 0 ? `${book.outputs.pdfs} PDF` : null,
              book.outputs.epubs > 0 ? `${book.outputs.epubs} EPUB` : null,
            ].filter(Boolean);

            return (
              <tr key={book.id} className="hover:bg-(--bg-card-hover)">
                <td className="px-4 py-3 max-w-md">
                  <Link to={`/books/${book.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {book.title}
                  </Link>
                  {book.skipSynthesis && (
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
  );
}
