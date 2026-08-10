import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { trpc } from "../trpc.ts";
import { getStoredProfileId } from "../lib/profile.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function HnDigestModal({ onClose }: { onClose: () => void }) {
  useBodyScrollLock();
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [perDay, setPerDay] = useState(false);
  const [count, setCount] = useState(10);
  const [folder, setFolder] = useState("hackernews-summaries");
  const [synthesize, setSynthesize] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [bookId, setBookId] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => sourceRef.current?.close(), []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  function run() {
    if (state === "running") return;
    setLines([]);
    setBookId(null);
    setState("running");
    const params = new URLSearchParams({
      from,
      to,
      count: String(count),
      perDay: perDay ? "1" : "0",
      synthesize: synthesize ? "1" : "0",
      ...(folder.trim() ? { folder: folder.trim() } : {}),
      ...(getStoredProfileId() ? { profile: getStoredProfileId()! } : {}),
    });
    const source = new EventSource(`/scripts/hn-top10/stream?${params}`);
    sourceRef.current = source;
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as { type: string; text?: string; code?: number };
      if (event.type === "line" && event.text) {
        setLines((prev) => [...prev, event.text!]);
        const match = event.text.match(/\/books\/([0-9a-f-]{36})/);
        if (match) setBookId(match[1]);
      } else if (event.type === "exit") {
        source.close();
        setState(event.code === 0 ? "done" : "failed");
        utils.books.list.invalidate();
        utils.folders.list.invalidate();
      } else if (event.type === "error") {
        source.close();
        setLines((prev) => [...prev, event.text ?? "Failed"]);
        setState("failed");
      }
    };
    source.onerror = () => {
      source.close();
      setState((s) => (s === "running" ? "failed" : s));
    };
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="hn-digest-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <span className="text-sm font-medium text-(--text-primary)">Hacker News daily digest</span>
          <button onClick={onClose} className="text-(--text-faint) hover:text-(--text-tertiary) p-1" title="Close">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-(--text-muted)">
            Builds a podcast-style book from the top stories on hckrnews.com — one chapter per story,
            with the community's take capped at the end. Pick a single day or a range to catch up:
            a range takes the overall top stories across it, or the top of each day.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-(--text-secondary)">
              From
              <input
                type="date"
                value={from}
                max={todayIso()}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (e.target.value > to) setTo(e.target.value);
                }}
                disabled={state === "running"}
                className="mt-1 block px-2 py-1.5 rounded-md border border-(--border) bg-(--bg-card) text-sm text-(--text-primary)"
                data-testid="hn-digest-from"
              />
            </label>
            <label className="text-xs text-(--text-secondary)">
              To
              <input
                type="date"
                value={to}
                min={from}
                max={todayIso()}
                onChange={(e) => setTo(e.target.value)}
                disabled={state === "running"}
                className="mt-1 block px-2 py-1.5 rounded-md border border-(--border) bg-(--bg-card) text-sm text-(--text-primary)"
                data-testid="hn-digest-to"
              />
            </label>
            <label className="text-xs text-(--text-secondary)">
              Stories
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 10)}
                disabled={state === "running"}
                className="mt-1 block w-20 px-2 py-1.5 rounded-md border border-(--border) bg-(--bg-card) text-sm text-(--text-primary)"
              />
            </label>
            <label className="text-xs text-(--text-secondary) flex-1 min-w-40">
              Folder
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                disabled={state === "running"}
                placeholder="(library root)"
                className="mt-1 block w-full px-2 py-1.5 rounded-md border border-(--border) bg-(--bg-card) text-sm text-(--text-primary)"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-(--text-secondary) pb-2">
              <input
                type="checkbox"
                checked={synthesize}
                onChange={(e) => setSynthesize(e.target.checked)}
                disabled={state === "running"}
                className="rounded"
              />
              Synthesize audio right away
            </label>
          </div>
          {from !== to && (
            <label className="flex items-center gap-2 text-xs text-(--text-secondary)">
              <input
                type="checkbox"
                checked={perDay}
                onChange={(e) => setPerDay(e.target.checked)}
                disabled={state === "running"}
                className="rounded"
                data-testid="hn-digest-per-day"
              />
              Top {count} of <em>each</em> day instead of the range overall
              {perDay && (
                <span className="text-(--text-faint)">
                  (~{count * (Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1)} chapters)
                </span>
              )}
            </label>
          )}

          {lines.length > 0 && (
            <div
              ref={logRef}
              className="h-56 overflow-y-auto rounded-md border border-(--border) bg-(--bg-subtle) p-2 font-mono text-[11px] leading-relaxed text-(--text-secondary) whitespace-pre-wrap"
              data-testid="hn-digest-log"
            >
              {lines.join("\n")}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-(--border) shrink-0">
          <button
            onClick={run}
            disabled={state === "running"}
            className="px-3 py-1.5 bg-orange-600 text-white rounded-md text-xs font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="hn-digest-run"
          >
            {state === "running" ? "Building…" : state === "done" || state === "failed" ? "Run again" : "Build book"}
          </button>
          {state === "running" && (
            <span className="text-xs text-(--text-muted)">
              Summarizing — takes a few minutes. Closing this window won't stop it.
            </span>
          )}
          {state === "done" && bookId && (
            <Link
              to={`/books/${bookId}`}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
              data-testid="hn-digest-open"
            >
              Open the book →
            </Link>
          )}
          {state === "failed" && <span className="text-xs text-red-600">Failed — see the log above</span>}
        </div>
      </div>
    </div>
  );
}
