import { useParams } from "react-router";
import { trpc } from "../trpc.ts";
import { UploadZone } from "../components/UploadZone.tsx";
import { BookList } from "../components/BookList.tsx";
import { Breadcrumbs } from "../components/Breadcrumbs.tsx";

export function Home() {
  const utils = trpc.useUtils();
  const { folderId = null } = useParams<{ folderId: string }>();
  const { data: folderPath = [] } = trpc.folders.path.useQuery(
    { id: folderId! },
    { enabled: !!folderId },
  );
  const currentFolder = folderPath.at(-1);

  return (
    <div className="min-h-screen bg-(--bg-page)">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-(--text-primary) mb-2">pdf2audio</h1>
        {folderId && (
          <div className="mb-4">
            <Breadcrumbs
              items={[
                { to: "/", label: "Home" },
                ...folderPath.map((f, i) =>
                  i === folderPath.length - 1 ? { label: f.name } : { to: `/folders/${f.id}`, label: f.name },
                ),
              ]}
            />
          </div>
        )}

        <section className="mb-8 mt-4">
          <UploadZone folderId={folderId} onUploadComplete={() => utils.books.list.invalidate()} />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-(--text-secondary) mb-3">
            {currentFolder ? `📁 ${currentFolder.name}` : "Books"}
          </h2>
          <BookList key={folderId ?? "root"} folderId={folderId} />
        </section>
      </div>
    </div>
  );
}
