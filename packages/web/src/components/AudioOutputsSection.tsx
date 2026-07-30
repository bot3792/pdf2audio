import { formatOutputDate, formatDuration } from "../lib/format.ts";

export type AssemblyRow = {
  id: string;
  outputPath: string;
  durationMs: number;
  chapterCount: number;
  chapterSummary: string;
  createdAt: string | Date;
};

export function AudioOutputsSection({
  assemblies,
  latestOutputPath,
  settings,
  actions,
  onDelete,
  isDeleting,
}: {
  assemblies: AssemblyRow[];
  latestOutputPath: string | null;
  settings?: React.ReactNode;
  actions: React.ReactNode;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <section className="rounded-xl border border-(--border) border-t-2 border-t-indigo-400/80 bg-(--bg-card) p-4 flex flex-col">
      <h2 className="text-lg font-semibold text-(--text-secondary) mb-3">
        <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mr-2">3 · Output</span>
        Audiobook
      </h2>
      {settings && <div className="mb-3">{settings}</div>}
      <div className="flex items-center gap-2 mb-3 flex-wrap">{actions}</div>
      {assemblies.length === 0 ? (
        <p className="text-sm text-(--text-muted)">
          No assemblies yet. Synthesize the selected chapters, then assemble them into one MP3 with chapter markers.
        </p>
      ) : (
        <ul className="divide-y divide-(--divide) rounded-lg border border-(--border)">
          {assemblies.map((assembly) => {
            const isLatest = assembly.outputPath === latestOutputPath;
            return (
              <li key={assembly.id} className="px-3 py-2.5 hover:bg-(--bg-card-hover)">
                <div className="flex items-center gap-2 text-sm text-(--text-secondary)">
                  {formatOutputDate(assembly.createdAt)}
                  {isLatest && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                      latest
                    </span>
                  )}
                  <span className="text-(--text-tertiary)" title={assembly.chapterSummary}>
                    {assembly.chapterCount} chapter{assembly.chapterCount !== 1 ? "s" : ""}
                  </span>
                  <span className="ml-auto tabular-nums text-(--text-tertiary)">{formatDuration(assembly.durationMs)}</span>
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <audio controls preload="none" className="h-8 min-w-0 flex-1">
                    <source src={`/audio/assembly/${assembly.id}`} type="audio/mpeg" />
                  </audio>
                  <a
                    href={`/download/assembly/${assembly.id}`}
                    download={assembly.outputPath.split("/").pop()}
                    className="text-xs text-green-600 hover:text-green-800 font-medium shrink-0"
                  >
                    Download
                  </a>
                  <button
                    onClick={() => {
                      if (confirm("Delete this assembly?")) {
                        onDelete(assembly.id);
                      }
                    }}
                    disabled={isDeleting}
                    className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50 shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
