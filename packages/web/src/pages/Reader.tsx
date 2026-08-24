import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { PdfCanvas } from "../components/reader/PdfCanvas.tsx";
import { CueOverlay } from "../components/reader/CueOverlay.tsx";
import {
  bodyFit,
  cueAtPoint,
  cueIndexAt,
  fetchCues,
  fetchManifest,
  wholePage,
  wordIndexAt,
  type ReaderCue,
  type ReaderCues,
  type ReaderManifest,
  type ReaderPage,
  type Rect,
} from "../lib/reader-doc.ts";
import { formatDuration } from "../lib/format.ts";

// Auto-scroll steps back this long after the reader touches the page themselves
const FOLLOW_PAUSE_MS = 5000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

// Logical widths of a current iPhone, which is the screen the page has to survive
const WIDTHS = [
  { id: "full", label: "Full", px: null },
  { id: "phone", label: "Phone", px: 393 },
  { id: "phone-landscape", label: "Phone ↻", px: 852 },
] as const;

const VIEWS = [
  { id: "column", label: "Column", hint: "Pages cropped to their columns — the real type, minus the margins" },
  { id: "page", label: "Page", hint: "The whole page, for figures and tables" },
  { id: "text", label: "Text", hint: "The spoken text reflowed at your own size" },
] as const;

type View = (typeof VIEWS)[number]["id"];

const GRANULARITY_HINT: Record<ReaderCues["granularity"], string> = {
  word: "Every word is timed by the engine that spoke it",
  sentence: "Sentence timings where the engine reported words, whole chunks elsewhere",
  chunk: "This audio predates word timings — a highlight covers a whole synthesis chunk",
};

// Below this the book's own type is too small to read at the chosen width, and text mode is
// the only honest answer rather than something the reader has to discover by squinting.
const LEGIBLE_PERCENT = 70;

type Spread = { key: string; page: ReaderPage; crop: Rect };

// The spread's crop as ten-thousandths of its page, the frame cue rects are already in
function normalizedCrop({ page, crop }: Spread): [number, number, number, number] {
  return [
    (crop[0] / page.w) * 10_000,
    (crop[1] / page.h) * 10_000,
    ((crop[0] + crop[2]) / page.w) * 10_000,
    ((crop[1] + crop[3]) / page.h) * 10_000,
  ];
}

export function Reader() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [cues, setCues] = useState<ReaderCues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<View>("column");
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["id"]>("full");
  const [debug, setDebug] = useState({ rects: false, layout: false });

  const audioRef = useRef<HTMLAudioElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
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
    if (chapter.mode === "text") setView("text");
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

  const spreads = useMemo<Spread[]>(() => {
    if (view === "page") return pages.map((page) => ({ key: `${page.i}`, page, crop: wholePage(page) }));
    return pages.flatMap((page) =>
      page.columns.map((column, i) => ({ key: `${page.i}-${i}`, page, crop: column })),
    );
  }, [pages, view]);

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
    if (Date.now() - lastGestureRef.current < FOLLOW_PAUSE_MS) return;
    const host = view === "text" ? document.querySelector<HTMLElement>('[data-testid="text-cue-active"]') : spreadFor(activeCue);
    if (!host) return;
    const box = host.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + box.top - window.innerHeight / 3, behavior: "smooth" });
  }, [activeIndex, view]);

  const fit = useMemo(() => {
    const cropWidth = spreads[0]?.crop[2] ?? pages[0]?.w ?? 0;
    const rendered = width === "full" ? pagesRef.current?.clientWidth ?? 0 : WIDTHS.find((w) => w.id === width)!.px!;
    return bodyFit(manifest?.book.medianBodyPt ?? null, cropWidth, rendered);
  }, [spreads, width, manifest?.book.medianBodyPt, pages]);

  if (error) return <ReaderShell bookId={id}><p className="text-sm text-red-600">{error}</p></ReaderShell>;
  if (!manifest || !chapter) return <ReaderShell bookId={id}><p className="text-sm text-(--text-muted)">Loading…</p></ReaderShell>;

  const maxWidth = WIDTHS.find((w) => w.id === width)!.px;

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
            className="max-w-[16rem] rounded border border-(--border) bg-(--bg-input) px-2 py-1 text-sm"
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

          <Segmented
            options={VIEWS.map((entry) => ({ id: entry.id, label: entry.label, title: entry.hint }))}
            value={view}
            onChange={(next) => setView(next as View)}
            testId="reader-view"
          />

          <Segmented
            options={WIDTHS.map((entry) => ({
              id: entry.id,
              label: entry.label,
              title: entry.px ? `Lay the pages out at ${entry.px} logical pixels — the width of a phone screen` : "Use the whole window",
            }))}
            value={width}
            onChange={(next) => setWidth(next as typeof width)}
            testId="reader-width"
          />

          <div className="ml-auto flex items-center gap-3 text-xs text-(--text-muted)">
            {cues && (
              <span
                className="rounded bg-(--bg-subtle) px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                title={GRANULARITY_HINT[cues.granularity]}
                data-testid="reader-granularity"
              >
                {cues.granularity}
              </span>
            )}
            {fit && view !== "text" && (
              <span
                className={fit.percent < LEGIBLE_PERCENT ? "text-amber-600" : undefined}
                title={`This book's body type is ${manifest.book.medianBodyPt}pt and renders at ${fit.px.toFixed(1)}px here, against the ${17}px a phone reads comfortably`}
                data-testid="reader-fit"
              >
                {fit.px.toFixed(0)}px · {fit.percent}%
              </span>
            )}
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

        {activeCue && view !== "text" && (
          <p className="mt-1.5 truncate text-sm text-(--text-secondary)" data-testid="reader-cue-text">
            <CueText cue={activeCue} word={activeWord} />
          </p>
        )}
      </div>

      {chapter.mode === "text" && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40" data-testid="reader-text-mode">
          This chapter's spoken text no longer maps onto the PDF — it was edited, generated, or
          extracted before page mapping existed — so it reads as text rather than on the page.
        </p>
      )}

      {fit && fit.percent < LEGIBLE_PERCENT && view !== "text" && (
        <p className="mb-3 rounded border border-(--border) bg-(--bg-subtle) px-3 py-2 text-sm text-(--text-tertiary)" data-testid="reader-too-small">
          At this width the book's own type renders at {fit.px.toFixed(0)}px — around {fit.percent}% of
          comfortable. {view === "page" ? "Column view crops the margins away; text" : "Text"} view reflows it at your own size.
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

      <div ref={pagesRef} className="mx-auto flex flex-col gap-4" style={maxWidth ? { maxWidth } : { maxWidth: "48rem" }}>
        {view === "text" ? (
          <TextView cues={cues} activeIndex={activeIndex} activeWord={activeWord} onSeek={seek} />
        ) : (
          spreads.map((spread) => (
            <div
              key={spread.key}
              data-page-index={spread.page.i}
              data-crop-norm={normalizedCrop(spread).join(",")}
            >
              <PdfCanvas
                url={manifest.sources[spread.page.src]?.url ?? ""}
                pageNumber={pageNumber(spread.page.i, spread.page.src)}
                crop={spread.crop}
                pageSize={{ w: spread.page.w, h: spread.page.h }}
                onPointer={(x, y) => {
                  if (!cues) return;
                  const at = cueAtPoint(cues.cues, spread.page.i, x, y);
                  if (at >= 0) seek(cues.cues[at].t[0]);
                }}
              >
                <CueOverlay page={spread.page} crop={spread.crop} cue={activeCue} cues={cues?.cues ?? []} debug={debug} />
              </PdfCanvas>
              <p className="mt-1 text-center text-[11px] text-(--text-faint)">{spread.page.i + 1}</p>
            </div>
          ))
        )}
        {view !== "text" && spreads.length === 0 && (
          <p className="text-sm text-(--text-muted)" data-testid="reader-no-pages">
            This chapter has no pages to show — switch to text view to read it.
          </p>
        )}
      </div>
    </ReaderShell>
  );
}

// The cue list is the chapter's spoken text, in order, so text view needs no second document —
// and every cue highlights exactly, including for chapters that never map onto a page.
function TextView({
  cues,
  activeIndex,
  activeWord,
  onSeek,
}: {
  cues: ReaderCues | null;
  activeIndex: number;
  activeWord: number;
  onSeek: (ms: number) => void;
}) {
  if (!cues) return <p className="text-sm text-(--text-muted)">No narration to read along with yet.</p>;

  return (
    <article className="rounded-lg bg-(--bg-card) p-6 text-lg leading-relaxed text-(--text-primary)" data-testid="reader-text-view">
      {cues.cues.map((cue, i) => (
        <span
          key={i}
          onClick={() => onSeek(cue.t[0])}
          className={`cursor-pointer ${i === activeIndex ? "bg-amber-200/60 dark:bg-amber-500/30" : "hover:bg-(--bg-subtle)"}`}
          data-testid={i === activeIndex ? "text-cue-active" : "text-cue"}
        >
          {i === activeIndex ? <CueText cue={cue} word={activeWord} /> : cue.s}{" "}
        </span>
      ))}
    </article>
  );
}

function CueText({ cue, word }: { cue: ReaderCue; word: number }) {
  if (word < 0 || !cue.w) return <>{cue.s}</>;
  return (
    <>
      {cue.w.slice(0, word).map((entry) => entry[2] + " ").join("")}
      <mark className="bg-amber-300 dark:bg-amber-500/50" data-testid="reader-word">{cue.w[word][2]}</mark>
      {" " + cue.w.slice(word + 1).map((entry) => entry[2]).join(" ")}
    </>
  );
}

// The spread showing this cue — in column view a page is several of them, and only the one
// holding the rect should be scrolled to.
function spreadFor(cue: ReaderCue | null): HTMLElement | null {
  const rect = cue?.r?.[0];
  if (!rect) return null;

  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-page-index="${rect[0]}"]`)];
  const holds = candidates.find((element) => {
    const box = element.dataset.cropNorm?.split(",").map(Number);
    return box?.length === 4 && rect[1] + rect[3] / 2 >= box[0] && rect[1] + rect[3] / 2 <= box[2];
  });
  return holds ?? candidates[0] ?? null;
}

function Segmented({
  options,
  value,
  onChange,
  testId,
}: {
  options: { id: string; label: string; title: string }[];
  value: string;
  onChange: (id: string) => void;
  testId: string;
}) {
  return (
    <div className="flex rounded border border-(--border) bg-(--bg-card) p-0.5" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          title={option.title}
          data-testid={`${testId}-${option.id}`}
          data-active={value === option.id}
          className={`rounded px-2 py-0.5 text-xs ${value === option.id ? "bg-blue-600 text-white" : "text-(--text-tertiary) hover:bg-(--bg-subtle)"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
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
