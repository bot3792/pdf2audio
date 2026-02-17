import { useParams, Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";

export function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: book, isLoading } = trpc.books.get.useQuery(
    { id: id! },
    {
      enabled: !!id,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status) return 3000;
        return status === "done" || status === "failed" ? false : 2000;
      },
    }
  );

  const cancelMutation = trpc.books.cancel.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: id! }),
  });
  const retryMutation = trpc.books.retry.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: id! }),
  });
  const deleteMutation = trpc.books.delete.useMutation({
    onSuccess: () => window.location.assign("/"),
  });
  const retryChapterMutation = trpc.chapters.retry.useMutation({
    onSuccess: () => utils.books.get.invalidate({ id: id! }),
  });

  if (isLoading || !book) {
    return (
      <div className="min-h-screen bg-zinc-100">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  const doneChapters = book.chapters.filter((c) => c.status === "done").length;

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block">
          &larr; Back
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{book.title}</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Voice: {book.voice} &middot; Speed: {book.speed}x &middot; {book.totalChapters} chapters
            </p>
          </div>
          <StatusBadge
            status={book.status}
            chaptersCompleted={doneChapters}
            totalChapters={book.totalChapters}
          />
        </div>

        {book.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700">{book.error}</p>
          </div>
        )}

        {book.status === "synthesizing" && book.totalChapters > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-zinc-600 mb-1">
              <span>Progress</span>
              <span>{doneChapters}/{book.totalChapters}</span>
            </div>
            <div className="w-full bg-zinc-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${(doneChapters / book.totalChapters) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          {book.status === "done" && book.outputPath && (
            <a
              href={`/download/${book.id}`}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
            >
              Download MP3
            </a>
          )}
          {book.status !== "done" && book.status !== "failed" && (
            <button
              onClick={() => cancelMutation.mutate({ id: book.id })}
              disabled={cancelMutation.isPending}
              className="px-4 py-2 bg-zinc-600 text-white rounded-md text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {book.status === "failed" && (
            <button
              onClick={() => retryMutation.mutate({ id: book.id })}
              disabled={retryMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Retry
            </button>
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
            Delete
          </button>
        </div>

        <h2 className="text-lg font-semibold text-zinc-800 mb-3">Chapters</h2>

        {book.chapters.length === 0 ? (
          <p className="text-zinc-500 text-sm">No chapters extracted yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-zinc-200">
                {book.chapters.map((chapter) => (
                  <tr key={chapter.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 text-sm text-zinc-600">{chapter.index + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-zinc-900">{chapter.title}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={chapter.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-600">
                      {chapter.durationMs ? formatDuration(chapter.durationMs) : "—"}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      {chapter.status === "done" && chapter.audioPath && (
                        <audio controls preload="none" className="h-8 inline-block">
                          <source src={`/audio/chapter/${chapter.id}`} type="audio/mpeg" />
                        </audio>
                      )}
                      {chapter.status === "failed" && (
                        <button
                          onClick={() => retryChapterMutation.mutate({ id: chapter.id })}
                          disabled={retryChapterMutation.isPending}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}
                      {chapter.error && (
                        <span className="text-xs text-red-500" title={chapter.error}>
                          error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
