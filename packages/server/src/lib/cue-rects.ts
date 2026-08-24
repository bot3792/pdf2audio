import type { ChapterTextMap } from "../schema.ts";
import type { SourceBlock } from "./marker.ts";
import type { GeometryLine, GeometryPage } from "./page-geometry.ts";

// [page, x, y, width, height] — page is the flat index across the book's PDFs, the rest are
// ten-thousandths of the page box, origin top-left.
export type CueRect = [number, number, number, number, number];

export type RectContext = {
  cleanText: string;
  textMap: ChapterTextMap;
  blocks: SourceBlock[];
  // Flat page index and geometry for a source block's own page number
  page: (blockPage: number) => { index: number; geometry: GeometryPage | null } | null;
};

const MAX_RECTS = 4;
// A line whose middle sits inside the block, allowing for polygon rounding
const CONTAINMENT_SLACK = 2;

export function rectsForRange(context: RectContext, start: number, end: number): CueRect[] {
  const perBlock: CueRect[][] = [];

  for (const span of context.textMap.spans) {
    if (span.end <= start || end <= span.start) continue;
    const block = context.blocks[span.block];
    const page = block ? context.page(block.page) : null;
    if (!block || !page) continue;

    // Without the page's own size there is nothing to normalize against, so no rect is offered
    const box = polygonBox(block.polygon);
    if (!page.geometry || !box) continue;

    const piece = context.cleanText.slice(Math.max(start, span.start), Math.min(end, span.end));
    const rects = rectsFromLines(page.geometry, box, piece) ?? [box];
    perBlock.push(rects.map((rect) => normalize(page.index, rect, page.geometry!)));
  }

  return capRects(perBlock);
}

type Box = [number, number, number, number];

function polygonBox(polygon: number[][] | undefined): Box | null {
  if (!polygon || polygon.length === 0) return null;
  let [x0, y0] = polygon[0];
  let [x1, y1] = polygon[0];
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function rectsFromLines(page: GeometryPage, box: Box, piece: string): Box[] | null {
  const lines = page.lines.filter((line) => centreInside(line.b, box));
  if (lines.length === 0) return null;

  const joined = joinLines(lines);
  const located = locate(joined.text, piece);
  if (!located) return null;

  const spans = new Map<number, { from: number; to: number }>();
  for (let i = located.start; i < located.end; i++) {
    const at = joined.origin[i];
    const current = spans.get(at.line);
    if (current) current.to = at.column + 1;
    else spans.set(at.line, { from: at.column, to: at.column + 1 });
  }

  const rects = [...spans.entries()].map(([index, span]) => lineRect(lines[index], span.from, span.to));
  if (rects.length <= 3) return rects;

  // The shape a text selection takes: partial first line, solid middle, partial last line
  return [rects[0], unionBox(rects.slice(1, -1)), rects[rects.length - 1]];
}

function centreInside(line: GeometryLine["b"], box: Box): boolean {
  const x = (line[0] + line[2]) / 2;
  const y = (line[1] + line[3]) / 2;
  return (
    x >= box[0] - CONTAINMENT_SLACK && x <= box[2] + CONTAINMENT_SLACK &&
    y >= box[1] - CONTAINMENT_SLACK && y <= box[3] + CONTAINMENT_SLACK
  );
}

function lineRect(line: GeometryLine, from: number, to: number): Box {
  if (!line.xs || from >= to) return [line.b[0], line.b[1], line.b[2], line.b[3]];
  const x0 = line.xs[Math.min(from, line.xs.length - 1)];
  const x1 = line.xs[Math.min(to, line.xs.length - 1)];
  return [Math.min(x0, x1), line.b[1], Math.max(x0, x1), line.b[3]];
}

function joinLines(lines: GeometryLine[]): { text: string; origin: { line: number; column: number }[] } {
  let text = "";
  const origin: { line: number; column: number }[] = [];
  for (let line = 0; line < lines.length; line++) {
    for (let column = 0; column < lines[line].t.length; column++) {
      text += lines[line].t[column];
      origin.push({ line, column });
    }
  }
  return { text, origin };
}

// Marker's block text and the PDF's own lines disagree on markdown, hyphen joins and spacing,
// so both sides are reduced to letters and digits before the piece is looked for.
function locate(haystack: string, needle: string): { start: number; end: number } | null {
  const target = project(haystack);
  const search = project(needle);
  if (search.value.length === 0) return null;

  const at = target.value.indexOf(search.value);
  if (at === -1) return null;
  return { start: target.map[at], end: target.map[at + search.value.length - 1] + 1 };
}

function project(text: string): { value: string; map: number[] } {
  let value = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!/[\p{L}\p{N}]/u.test(text[i])) continue;
    value += text[i].toLowerCase();
    map.push(i);
  }
  return { value, map };
}

function unionBox(boxes: Box[]): Box {
  let [x0, y0, x1, y1] = boxes[0];
  for (const box of boxes) {
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  return [x0, y0, x1, y1];
}

function normalize(page: number, box: Box, geometry: GeometryPage): CueRect {
  const width = geometry.w || 1;
  const height = geometry.h || 1;
  const to = (value: number, size: number) => Math.max(0, Math.min(10_000, Math.round((value / size) * 10_000)));
  const x = to(box[0], width);
  const y = to(box[1], height);
  return [page, x, y, to(box[2], width) - x, to(box[3], height) - y];
}

// One rect per line is the good case; past the cap a cue falls back to a box per block, and
// past that to a single box — coarser, never wrong.
function capRects(perBlock: CueRect[][]): CueRect[] {
  const all = perBlock.flat();
  if (all.length <= MAX_RECTS) return all;

  const perBlockBoxes = perBlock.map((rects) => coverRects(rects));
  if (perBlockBoxes.length <= MAX_RECTS) return perBlockBoxes;

  const byPage = new Map<number, CueRect[]>();
  for (const rect of perBlockBoxes) byPage.set(rect[0], [...(byPage.get(rect[0]) ?? []), rect]);
  return [...byPage.values()].map((rects) => coverRects(rects)).slice(0, MAX_RECTS);
}

function coverRects(rects: CueRect[]): CueRect {
  const box = unionBox(rects.map((rect) => [rect[1], rect[2], rect[1] + rect[3], rect[2] + rect[4]]));
  return [rects[0][0], box[0], box[1], box[2] - box[0], box[3] - box[1]];
}
