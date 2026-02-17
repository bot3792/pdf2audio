import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { StatusBadge } from "./StatusBadge.tsx";

export function BookList() {
  const { data: books, isLoading } = trpc.books.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  if (isLoading) {
    return <p className="text-zinc-500 py-4">Loading...</p>;
  }

  if (!books || books.length === 0) {
    return <p className="text-zinc-500 py-4">No books yet. Upload a PDF to get started.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Title</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Voice</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-zinc-200">
          {books.map((book) => (
            <tr key={book.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3">
                <Link to={`/books/${book.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                  {book.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge
                  status={book.status}
                  chaptersCompleted={book.chaptersCompleted}
                  totalChapters={book.totalChapters}
                />
              </td>
              <td className="px-4 py-3 text-sm text-zinc-600">{book.voice}</td>
              <td className="px-4 py-3 text-sm text-zinc-600">
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
