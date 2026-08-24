import { cropStyle, type ReaderCue, type ReaderPage, type Rect } from "../../lib/reader-doc.ts";

// Everything the reader draws over a page: the cue being spoken, and — with the debug toggles
// on — every cue's rects and the boxes the layout was derived from.
export function CueOverlay({
  page,
  crop,
  cue,
  cues,
  debug,
}: {
  page: ReaderPage;
  crop: Rect;
  cue: ReaderCue | null;
  cues: ReaderCue[];
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

      {(cue?.r ?? [])
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] bg-amber-300/40 mix-blend-multiply dark:mix-blend-screen"
            style={style(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-rect"
          />
        ))}
    </div>
  );
}
