import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc.ts";
import { TRANSLATION_LANGUAGES } from "../lib/languages.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";

type ChapterSummary = { id: string; index: number; title: string };

export function TranslationModal({
  bookId,
  chapters,
  initialLanguage,
  initialChapterId,
  onClose,
}: {
  bookId: string;
  chapters: ChapterSummary[];
  initialLanguage: string | null;
  initialChapterId?: string | null;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const utils = trpc.useUtils();
  const [language, setLanguage] = useState(initialLanguage ?? "Bulgarian");
  const [selectedId, setSelectedId] = useState<string | null>(initialChapterId ?? chapters[0]?.id ?? null);
  const translatedPane = useRef<HTMLDivElement>(null);
  const selectedChapterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedChapterRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const { data: bookList = [] } = trpc.translations.listForBook.useQuery(
    { bookId, language },
    {
      refetchInterval: (query) =>
        query.state.data?.some((t) => t.status === "pending" || t.status === "translating") ? 2000 : false,
    },
  );

  const { data: chapter } = trpc.chapters.get.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId },
  );

  const { data: translation } = trpc.translations.get.useQuery(
    { chapterId: selectedId!, language },
    {
      enabled: !!selectedId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === "pending" || s === "translating" ? 1000 : false;
      },
    },
  );

  const refresh = () => {
    utils.translations.get.invalidate();
    utils.translations.listForBook.invalidate();
  };
  const startMutation = trpc.translations.start.useMutation({ onSuccess: refresh });
  const stopMutation = trpc.translations.stop.useMutation({ onSuccess: refresh });

  const running = translation?.status === "pending" || translation?.status === "translating";

  useEffect(() => {
    if (running && translatedPane.current) {
      translatedPane.current.scrollTop = translatedPane.current.scrollHeight;
    }
  }, [translation?.text, running]);

  const sourceText = chapter ? chapter.customText ?? chapter.cleanText ?? chapter.rawText : "";
  const statusByChapter = new Map(bookList.map((t) => [t.chapterId, t]));

  const startLabel =
    translation?.status === "suspended" ? "Resume" :
    translation?.status === "failed" ? "Retry" :
    translation?.status === "done" ? "Re-translate" :
    "Translate";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="translation-modal">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-(--bg-card) rounded-xl shadow-2xl w-[96vw] h-[92vh] flex flex-col">
        <div className="flex items-center gap-4 p-4 border-b border-(--border)">
          <h2 className="text-lg font-semibold text-(--text-primary)">Translation</h2>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={running}
            title={running ? "Stop the running translation before switching language" : "Target language"}
            className="px-2 py-1 rounded-md border border-(--border) bg-(--bg-card) text-sm text-(--text-primary) disabled:opacity-50"
            data-testid="translation-language"
          >
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <button
            onClick={() => selectedId && startMutation.mutate({
              chapterId: selectedId,
              language,
              restart: translation?.status === "done",
            })}
            disabled={!selectedId || running || startMutation.isPending}
            title={
              !selectedId ? "Select a chapter" :
              running ? "Translation is running" :
              translation?.status === "suspended" ? "Continue from where it stopped" :
              translation?.status === "done" ? "Discard this translation and translate again" :
              "Translate this chapter"
            }
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="translation-start"
          >
            {startLabel}
          </button>
          <button
            onClick={() => selectedId && stopMutation.mutate({ chapterId: selectedId, language })}
            disabled={!selectedId || !running || stopMutation.isPending}
            title={running ? "Stop and keep everything translated so far" : "Nothing is running"}
            className="px-3 py-1.5 bg-(--bg-subtle) text-(--text-secondary) rounded-md text-sm font-medium hover:bg-(--border) disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="translation-stop"
          >
            Stop
          </button>

          {running ? (
            <span className="text-sm text-blue-600" data-testid="translation-progress">
              Translating{translation?.progress ? ` · ${translation.progress} chunks` : ""}...
            </span>
          ) : translation?.status === "suspended" ? (
            <span className="text-sm text-(--text-muted)">
              Stopped{translation.progress ? ` at ${translation.progress} chunks` : ""} — partial kept
            </span>
          ) : translation?.status === "failed" ? (
            <span className="text-sm text-red-600 truncate" title={translation.error ?? undefined}>
              Failed: {translation.error}
            </span>
          ) : null}
          {startMutation.error || stopMutation.error ? (
            <span className="text-sm text-red-600 truncate">
              {(startMutation.error ?? stopMutation.error)?.message}
            </span>
          ) : null}

          <div className="flex-1" />
          <button onClick={onClose} className="shrink-0 p-1 text-(--text-faint) hover:text-(--text-tertiary) rounded">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-64 shrink-0 overflow-y-auto border-r border-(--border) p-2">
            {chapters.map((ch) => {
              const t = statusByChapter.get(ch.id);
              return (
                <button
                  key={ch.id}
                  ref={selectedId === ch.id ? selectedChapterRef : undefined}
                  onClick={() => setSelectedId(ch.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 hover:bg-(--bg-subtle) ${
                    selectedId === ch.id ? "bg-blue-50 dark:bg-blue-950/40" : ""
                  }`}
                >
                  <span className="shrink-0 text-xs font-mono text-(--text-faint) w-6 text-right">{ch.index + 1}.</span>
                  <span className="flex-1 truncate text-(--text-primary)" title={ch.title}>{ch.title}</span>
                  {t ? (
                    <span
                      className={`shrink-0 h-2 w-2 rounded-full ${
                        t.status === "done" ? "bg-green-500" :
                        t.status === "translating" || t.status === "pending" ? "bg-blue-500 animate-pulse" :
                        t.status === "suspended" ? "bg-amber-500" :
                        "bg-red-500"
                      }`}
                      title={`${t.status}${t.progress ? ` (${t.progress})` : ""}`}
                    />
                  ) : null}
                </button>
              );
            })}
            {chapters.length === 0 ? (
              <p className="text-sm text-(--text-muted) p-2">No chapters yet.</p>
            ) : null}
          </div>

          <div className="flex-1 min-w-0 flex flex-col border-r border-(--border)">
            <h3 className="shrink-0 px-4 pt-3 pb-1 text-xs font-medium text-(--text-muted) uppercase tracking-wider">
              Original
            </h3>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <p className="text-sm text-(--text-primary) whitespace-pre-wrap leading-relaxed">
                {sourceText || (selectedId ? "Loading..." : "Select a chapter.")}
              </p>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <h3 className="shrink-0 px-4 pt-3 pb-1 text-xs font-medium text-(--text-muted) uppercase tracking-wider">
              {language}
            </h3>
            <div ref={translatedPane} className="flex-1 overflow-y-auto px-4 pb-4">
              <p className="text-sm text-(--text-primary) whitespace-pre-wrap leading-relaxed" data-testid="translation-text">
                {translation?.text || (
                  <span className="text-(--text-muted)">
                    {running ? "Waiting for the first chunk..." : "No translation yet."}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
