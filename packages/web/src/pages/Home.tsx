import { useParams } from "react-router";
import { trpc } from "../trpc.ts";
import { UploadZone } from "../components/UploadZone.tsx";
import { BookList } from "../components/BookList.tsx";
import { Breadcrumbs } from "../components/Breadcrumbs.tsx";
import { ProfileSwitcher } from "../components/ProfileSwitcher.tsx";
import type { DragItems } from "../lib/dnd.ts";

export function Home() {
  const utils = trpc.useUtils();
  const { folderId = null } = useParams<{ folderId: string }>();
  const { data: folderPath = [] } = trpc.folders.path.useQuery(
    { id: folderId! },
    { enabled: !!folderId },
  );
  const currentFolder = folderPath.at(-1);

  const moveBooksMutation = trpc.books.moveToFolder.useMutation();
  const moveFolderMutation = trpc.folders.move.useMutation();
  async function dropOnCrumb(targetFolderId: string | null, items: DragItems) {
    try {
      if (items.bookIds.length > 0) {
        await moveBooksMutation.mutateAsync({ ids: items.bookIds, folderId: targetFolderId });
      }
      for (const id of items.folderIds.filter((fid) => fid !== targetFolderId)) {
        await moveFolderMutation.mutateAsync({ id, parentId: targetFolderId });
      }
    } finally {
      utils.books.list.invalidate();
      utils.folders.list.invalidate();
    }
  }

  return (
    <div className="min-h-screen bg-(--bg-page)">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        <div className="flex items-center mb-2">
          <h1 className="text-2xl font-bold text-(--text-primary)">pdf2audio</h1>
          <ProfileSwitcher />
        </div>
        {folderId && (
          <div className="mb-4">
            <Breadcrumbs
              onDropItems={dropOnCrumb}
              items={[
                { to: "/", label: "Home", dropFolderId: null },
                ...folderPath.map((f, i) =>
                  i === folderPath.length - 1
                    ? { label: f.name }
                    : { to: `/folders/${f.id}`, label: f.name, dropFolderId: f.id },
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
