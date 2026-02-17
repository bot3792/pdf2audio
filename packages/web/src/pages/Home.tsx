import { trpc } from "../trpc.ts";
import { UploadZone } from "../components/UploadZone.tsx";
import { BookList } from "../components/BookList.tsx";

export function Home() {
  const utils = trpc.useUtils();

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-6">pdf2audio</h1>

        <section className="mb-8">
          <UploadZone onUploadComplete={() => utils.books.list.invalidate()} />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-zinc-800 mb-3">Books</h2>
          <BookList />
        </section>
      </div>
    </div>
  );
}
