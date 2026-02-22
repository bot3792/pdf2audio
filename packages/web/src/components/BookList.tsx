import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";

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
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Voice</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Created</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-(--bg-card) divide-y divide-(--divide)">
          {books.map((book) => (
            <tr key={book.id} className="hover:bg-(--bg-card-hover)">
              <td className="px-4 py-3">
                <Link to={`/books/${book.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                  {book.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge
                  status={book.status}
                  error={book.error}
                  chaptersCompleted={book.chaptersCompleted}
                  totalChapters={book.totalChapters}
                />
              </td>
              <td className="px-4 py-3 text-sm text-(--text-tertiary)">{book.voice}</td>
              <td className="px-4 py-3 text-sm text-(--text-tertiary)">
                {new Date(book.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                {book.status === "done" && (
                  <a
                    href={`/download/${book.id}`}
                    className="text-sm text-green-600 hover:text-green-800 font-medium"
                  >
                    Download
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
