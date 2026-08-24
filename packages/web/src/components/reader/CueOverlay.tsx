import { boxStyle, type ReaderCue, type ReaderPage } from "../../lib/reader-doc.ts";

// Everything the reader draws on a page: the cue being spoken, the word inside it when the
// engine reported one, and — with the debug panel open — the boxes the rects were derived from.
export function CueOverlay({
  page,
  cue,
  cues,
  debug,
}: {
  page: ReaderPage;
  cue: ReaderCue | null;
  cues: ReaderCue[];
  debug: { rects: boolean; layout: boolean };
}) {
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="cue-overlay">
      {debug.layout && (
        <>
          <div className="absolute border border-dashed border-sky-500/70" style={boxStyle(...normalizeBox(page, page.content))} />
          {page.columns.map((column, i) => (
            <div key={i} className="absolute border border-dashed border-fuchsia-500/70" style={boxStyle(...normalizeBox(page, column))} />
          ))}
        </>
      )}

      {debug.rects &&
        cues.flatMap((other, i) =>
          (other.r ?? [])
            .filter(([p]) => p === page.i)
            .map((rect, j) => (
              <div key={`${i}-${j}`} className="absolute border border-emerald-500/40" style={boxStyle(rect[1], rect[2], rect[3], rect[4])} />
            )),
        )}

      {(cue?.r ?? [])
        .filter(([p]) => p === page.i)
        .map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] bg-amber-300/40 mix-blend-multiply dark:mix-blend-screen"
            style={boxStyle(rect[1], rect[2], rect[3], rect[4])}
            data-testid="cue-rect"
          />
        ))}
    </div>
  );
}

// Page boxes are in points; rects are in ten-thousandths. One conversion, here.
function normalizeBox(page: ReaderPage, box: [number, number, number, number]): [number, number, number, number] {
  return [
    (box[0] / page.w) * 10_000,
    (box[1] / page.h) * 10_000,
    (box[2] / page.w) * 10_000,
    (box[3] / page.h) * 10_000,
  ];
}
