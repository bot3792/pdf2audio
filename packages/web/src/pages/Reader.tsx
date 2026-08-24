import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { PdfCanvas } from "../components/reader/PdfCanvas.tsx";
import { CueOverlay } from "../components/reader/CueOverlay.tsx";
import {
  cueAtPoint,
  cueIndexAt,
  fetchCues,
  fetchManifest,
  wordIndexAt,
  type ReaderCues,
  type ReaderManifest,
} from "../lib/reader-doc.ts";
import { formatDuration } from "../lib/format.ts";

// Auto-scroll steps back this long after the reader touches the page themselves
const FOLLOW_PAUSE_MS = 5000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

const GRANULARITY_HINT: Record<ReaderCues["granularity"], string> = {
  word: "Every word is timed by the engine that spoke it",
  sentence: "Sentence timings where the engine reported words, whole chunks elsewhere",
  chunk: "This audio predates word timings — a highlight covers a whole synthesis chunk",
};

export function Reader() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [cues, setCues] = useState<ReaderCues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [debug, setDebug] = useState({ rects: false, layout: false });

  const audioRef = useRef<HTMLAudioElement>(null);
  const lastGestureRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    fetchManifest(id).then(setManifest).catch((err: Error) => setError(err.message));
  }, [id]);

  const chapterIndex = Number(searchParams.get("chapter") ?? 0);
  const chapter = manifest?.chapters.find((c) => c.i === chapterIndex) ?? manifest?.chapters[0] ?? null;

  useEffect(() => {
    if (!chapter) return;
    setCues(null);
    setMs(0);
    setError(null);
    if (!chapter.audio) return;
    fetchCues(chapter.cues).then(setCues).catch((err: Error) => setError(err.message));
  }, [chapter?.id]);

  // A time update per frame while playing; the element's own timeupdate fires far too rarely
  // for a highlight to look like it is following the voice.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setMs(audio.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const note = () => { lastGestureRef.current = Date.now(); };
    window.addEventListener("wheel", note, { passive: true });
    window.addEventListener("touchmove", note, { passive: true });
    return () => {
      window.removeEventListener("wheel", note);
      window.removeEventListener("touchmove", note);
    };
  }, []);

  const activeIndex = cues ? cueIndexAt(cues.cues, ms) : -1;
  const activeCue = activeIndex >= 0 ? cues!.cues[activeIndex] : null;
  const activeWord = activeCue ? wordIndexAt(activeCue, ms) : -1;

  const pages = useMemo(() => {
    if (!manifest || !chapter || chapter.pageStart === null) return [];
    return manifest.pages.filter((page) => page.i >= chapter.pageStart! && page.i <= (chapter.pageEnd ?? chapter.pageStart!));
  }, [manifest, chapter?.id]);

  // A page's number inside its own PDF, which is what pdf.js is asked for
  const pageNumber = useCallback(
    (index: number, src: number) => index - (manifest?.pages.find((page) => page.src === src)?.i ?? 0) + 1,
    [manifest],
  );

  const seek = (to: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = to / 1000;
    setMs(to);
  };

  useEffect(() => {
    const rect = activeCue?.r?.[0];
    if (!rect || Date.now() - lastGestureRef.current < FOLLOW_PAUSE_MS) return;
    const host = document.querySelector<HTMLElement>(`[data-page-index="${rect[0]}"]`);
    if (!host) return;
    const box = host.getBoundingClientRect();
    const top = window.scrollY + box.top + (rect[2] / 10_000) * box.height - window.innerHeight / 3;
    window.scrollTo({ top, behavior: "smooth" });
  }, [activeIndex]);

  if (error) return <ReaderShell bookId={id}><p className="text-sm text-red-600">{error}</p></ReaderShell>;
  if (!manifest || !chapter) return <ReaderShell bookId={id}><p className="text-sm text-(--text-muted)">Loading…</p></ReaderShell>;

  return (
    <ReaderShell bookId={id} title={manifest.book.title}>
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-(--border) bg-(--bg-page)/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => (playing ? audioRef.current?.pause() : audioRef.current?.play())}
            disabled={!chapter.audio}
            title={chapter.audio ? (playing ? "Pause" : "Play the narration") : "This chapter has no audio yet"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            data-testid="reader-play"
          >
            {playing ? "❚❚" : "▶"}
          </button>

          <select
            value={chapter.i}
            onChange={(event) => setSearchParams({ chapter: event.target.value })}
            className="max-w-[18rem] rounded border border-(--border) bg-(--bg-input) px-2 py-1 text-sm"
            data-testid="reader-chapter"
          >
            {manifest.chapters.map((entry) => (
              <option key={entry.id} value={entry.i}>
                {entry.i + 1}. {entry.title}
              </option>
            ))}
          </select>

          <select
            value={speed}
            onChange={(event) => {
              setSpeed(Number(event.target.value));
              if (audioRef.current) audioRef.current.playbackRate = Number(event.target.value);
            }}
            title="Playback speed"
            className="rounded border border-(--border) bg-(--bg-input) px-1 py-1 text-xs"
          >
            {SPEEDS.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
          </select>

          <span className="tabular-nums text-xs text-(--text-muted)">
            {formatDuration(ms)} / {formatDuration(cues?.totalMs ?? chapter.durationMs ?? 0)}
          </span>

          {cues && (
            <span
              className="rounded bg-(--bg-subtle) px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--text-muted)"
              title={GRANULARITY_HINT[cues.granularity]}
              data-testid="reader-granularity"
            >
              {cues.granularity}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3 text-xs text-(--text-muted)">
            {manifest.book.medianBodyPt !== null && <span title="Median body type size in this book">{manifest.book.medianBodyPt}pt</span>}
            <label className="flex items-center gap-1" title="Draw every cue's rectangles, not just the one being spoken">
              <input type="checkbox" checked={debug.rects} onChange={(e) => setDebug({ ...debug, rects: e.target.checked })} />
              rects
            </label>
            <label className="flex items-center gap-1" title="Draw the content box and the detected columns">
              <input type="checkbox" checked={debug.layout} onChange={(e) => setDebug({ ...debug, layout: e.target.checked })} />
              layout
            </label>
          </div>
        </div>

        {activeCue && (
          <p className="mt-1.5 truncate text-sm text-(--text-secondary)" data-testid="reader-cue-text">
            {activeWord >= 0 ? (
              <>
                {activeCue.w!.slice(0, activeWord).map((word) => word[2] + " ").join("")}
                <mark className="bg-amber-200 dark:bg-amber-500/40">{activeCue.w![activeWord][2]}</mark>
                {" " + activeCue.w!.slice(activeWord + 1).map((word) => word[2]).join(" ")}
              </>
            ) : (
              activeCue.s
            )}
          </p>
        )}
      </div>

      {chapter.mode === "text" && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40" data-testid="reader-text-mode">
          This chapter's spoken text no longer maps onto the PDF — it was edited, generated, or
          extracted before page mapping existed — so nothing is highlighted on the page.
        </p>
      )}

      <audio
        ref={audioRef}
        src={chapter.audio ?? undefined}
        preload="metadata"
        onPlay={() => { setPlaying(true); if (audioRef.current) audioRef.current.playbackRate = speed; }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => { if (!playing && audioRef.current) setMs(audioRef.current.currentTime * 1000); }}
        className="hidden"
      />

      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {pages.map((page) => (
          <div key={page.i} data-page-index={page.i}>
            <PdfCanvas
              url={manifest.sources[page.src]?.url ?? ""}
              pageNumber={pageNumber(page.i, page.src)}
              aspectRatio={page.w / page.h}
              onPointer={(x, y) => {
                if (!cues) return;
                const at = cueAtPoint(cues.cues, page.i, x, y);
                if (at >= 0) seek(cues.cues[at].t[0]);
              }}
            >
              <CueOverlay page={page} cue={activeCue} cues={cues?.cues ?? []} debug={debug} />
            </PdfCanvas>
            <p className="mt-1 text-center text-[11px] text-(--text-faint)">{page.i + 1}</p>
          </div>
        ))}
        {pages.length === 0 && (
          <p className="text-sm text-(--text-muted)" data-testid="reader-no-pages">
            This chapter has no pages to show — open it in the book view to read its text.
          </p>
        )}
      </div>
    </ReaderShell>
  );
}

function ReaderShell({ bookId, title, children }: { bookId?: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-(--bg-page) px-4 py-3">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-2 flex items-center gap-2 text-sm text-(--text-muted)">
          <Link to={bookId ? `/books/${bookId}` : "/"} className="text-blue-600 hover:text-blue-800" data-testid="reader-back">
            ← Back
          </Link>
          {title && <span className="truncate text-(--text-secondary)">{title}</span>}
        </nav>
        {children}
      </div>
    </div>
  );
}
