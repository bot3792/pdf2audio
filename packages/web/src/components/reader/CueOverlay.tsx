import { cropStyle, type CueRect, type ReaderCue, type ReaderPage, type Rect } from "../../lib/reader-doc.ts";

// The page under these is white paper in either theme, so they always multiply — screening
// against white erases the band and leaves only the glyphs tinted
export function CueOverlay({
  page,
  crop,
  cue,
  word,
  cues,
  linked,
  ring,
  debug,
}: {
  page: ReaderPage;
  crop: Rect;
  cue: ReaderCue | null;
  word: CueRect[] | null;
  cues: ReaderCue[];
  // The chunk the pointer is resting on, tinted; and the one cue a click would seek to, ringed
  linked: CueRect[];
  ring: CueRect[];
  debug: { rects: boolean; layout: boolean };
}) {
  const style = (x: number, y: number, width: number, height: number) => cropStyle(page, crop, x, y, width, height);
  const pointsToRect = (box: Rect) => style(
    (box[0] / page.w) * 10_000,
    (box[1] / page.h) * 10_000,
    (box[2] / page.w) * 10_000,
    (box[3] / page.h) * 10_000,
  );

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="cue-overlay">
      {debug.layout && (
        <>
          <div className="absolute border border-dashed border-sky-500/70" style={pointsToRect(page.content)} />
          {page.columns.map((column, i) => (
            <div key={i} className="absolute border border-dashed border-fuchsia-500/70" style={pointsToRect(column)} />
          ))}
        </>
      )}

      {debug.rects &&
        cues.flatMap((other, i) =>
          (other.r ?? [])
            .filter(([p]) => p === page.i)
            .map((rect, j) => (
              <div key={`${i}-${j}`} className="absolute border border-emerald-500/40" style={style(rect[1], rect[2], rect[3], rect[4])} />
            )),
        )}

      {linked
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] bg-yellow-300/35 mix-blend-multiply"
            style={style(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-linked-rect"
          />
        ))}

      {ring
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] outline-2 outline-offset-1 outline-sky-500/70"
            style={style(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-ring-rect"
          />
        ))}

      {(cue?.r ?? [])
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] bg-amber-300/50 mix-blend-multiply"
            style={style(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-rect"
          />
        ))}

      {(word ?? [])
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            // The element persists between words, so moving it is a transition rather than a jump
            className="absolute rounded-[2px] bg-amber-400/80 mix-blend-multiply transition-all duration-150 ease-out motion-reduce:transition-none"
            style={style(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-word-rect"
          />
        ))}
    </div>
  );
}
