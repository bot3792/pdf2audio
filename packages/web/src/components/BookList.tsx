import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { formatBytes, formatRelativeTime } from "../lib/format.ts";

function ActivityPill({ label, color, pulse = true }: { label: string; color: string; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  );
}

export function BookList() {
  const { data: books, isLoading } = trpc.books.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  if (isLoading) {
    return <p className="text-(--text-muted) py-4">Loading...</p>;
  }

  if (!books || books.length === 0) {
    return <p className="text-(--text-muted) py-4">No books yet. Upload a PDF to get started.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-(--border)">
      <table className="min-w-full divide-y divide-(--divide)">
        <thead className="bg-(--bg-subtle)">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Title</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Chapters</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Activity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Languages</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Outputs</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Size</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">Last activity</th>
          </tr>
        </thead>
        <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
          {books.map((book) => {
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
