// The reader consumes these two documents and nothing else — never a database row
export type Rect = [x: number, y: number, width: number, height: number];
export type CueRect = [page: number, x: number, y: number, width: number, height: number];

export type ReaderPage = { i: number; src: number; w: number; h: number; rot: number; content: Rect; columns: Rect[] };

export type ReaderChapter = {
  i: number;
  id: string;
  title: string;
  audio: string | null;
  cues: string;
  durationMs: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  mode: "page" | "text";
};

export type ReaderManifest = {
  format: string;
  book: { id: string; title: string; language: string; medianBodyPt: number | null };
  sources: { index: number; filename: string; url: string; pageCount: number }[];
  pages: ReaderPage[];
  chapters: ReaderChapter[];
};

export type ReaderCue = { t: [number, number]; s: string; r?: CueRect[]; w?: [number, number, string][] };

export type ReaderCues = { format: string; totalMs: number; granularity: "word" | "sentence" | "chunk"; cues: ReaderCue[] };

export async function fetchManifest(bookId: string): Promise<ReaderManifest> {
  return fetchJson(`/read/book/${bookId}/book.json`);
}

export async function fetchCues(url: string): Promise<ReaderCues> {
  return fetchJson(url);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

// Cues are ordered and non-overlapping, so the one playing is a binary search away
export function cueIndexAt(cues: ReaderCue[], ms: number): number {
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].t[0] > ms) high = mid - 1;
    else {
      found = mid;
      low = mid + 1;
    }
  }
  // Before the first word (Kokoro's can start 275ms in) and in the gaps between cues, one stays lit
  return found >= 0 ? found : cues.length > 0 ? 0 : -1;
}

export function wordIndexAt(cue: ReaderCue, ms: number): number {
  if (!cue.w) return -1;
  for (let i = cue.w.length - 1; i >= 0; i--) {
    if (ms >= cue.w[i][0]) return ms < cue.w[i][1] ? i : -1;
  }
  return -1;
}

// Rects are ten-thousandths of the whole page; the crop, in points, is what is on screen
export function cropStyle(page: ReaderPage, crop: Rect, x: number, y: number, width: number, height: number) {
  const left = (x / 10_000) * page.w;
  const top = (y / 10_000) * page.h;
  return {
    left: `${((left - crop[0]) / crop[2]) * 100}%`,
    top: `${((top - crop[1]) / crop[3]) * 100}%`,
    width: `${(((width / 10_000) * page.w) / crop[2]) * 100}%`,
    height: `${(((height / 10_000) * page.h) / crop[3]) * 100}%`,
  };
}

export function wholePage(page: ReaderPage): Rect {
  return [0, 0, page.w, page.h];
}

// iOS body text is 17 logical points, which is the same number of CSS pixels here
export const COMFORTABLE_BODY_PX = 17;

export function bodyFit(medianBodyPt: number | null, cropWidthPt: number, renderedWidthPx: number) {
  if (medianBodyPt === null || cropWidthPt <= 0) return null;
  const px = medianBodyPt * (renderedWidthPx / cropWidthPt);
  return { px, percent: Math.round((px / COMFORTABLE_BODY_PX) * 100) };
}

export function cueAtPoint(cues: ReaderCue[], page: number, x: number, y: number): number {
  return cues.findIndex((cue) =>
    cue.r?.some(([p, rx, ry, rw, rh]) => p === page && x >= rx && x <= rx + rw && y >= ry && y <= ry + rh),
  );
}
