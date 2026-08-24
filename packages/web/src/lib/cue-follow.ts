// Keeping the spoken cue in view, in whatever is scrolling — the reader scrolls the window,
// the chapter modal scrolls its own panel.
export type FollowBand = { top: number; bottom: number; landing: number };

// Auto-scroll steps back this long after the reader touches the page themselves
const PAUSE_MS = 5000;

let lastGesture = 0;
let listening = false;

function watchGestures() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const note = () => { lastGesture = Date.now(); };
  window.addEventListener("wheel", note, { passive: true, capture: true });
  window.addEventListener("touchmove", note, { passive: true, capture: true });
}

function scrollParent(element: Element): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

type Span = { top: number; bottom: number };

function span(elements: Element[], viewTop: number): Span | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    const box = element.getBoundingClientRect();
    if (box.height === 0) continue;
    top = Math.min(top, box.top - viewTop);
    bottom = Math.max(bottom, box.bottom - viewTop);
  }
  return top === Infinity ? null : { top, bottom };
}

export function followCue(force: boolean, band: FollowBand): void {
  watchGestures();
  if (!force && Date.now() - lastGesture < PAUSE_MS) return;

  const all = (selector: string) => [...document.querySelectorAll(selector)];
  const marks = all('[data-testid="cue-rect"], [data-testid="text-cue-active"]');
  if (marks.length === 0) return;

  const scroller = scrollParent(marks[0]);
  const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
  const safeTop = band.top;
  const safeBottom = viewHeight - band.bottom;

  const cue = span(marks, viewTop);
  if (!cue) return;
  // A whole sentence stays in view while it fits between the safe edges; past that the word being
  // spoken is what has to stay, or a long cue would strand the cursor below the fold
  const word = span(all('[data-testid="cue-word-rect"], [data-testid="reader-word"]'), viewTop);
  const focus = cue.bottom - cue.top <= safeBottom - safeTop ? cue : word ?? { top: cue.top, bottom: cue.top };

  if (!force && focus.top >= safeTop && focus.bottom <= safeBottom) return;

  // Land it high enough that the next several cues fit below — following along should scroll in
  // stretches, not on every sentence — without pushing its own tail past the bottom edge
  const height = focus.bottom - focus.top;
  const landing = Math.max(safeTop, Math.min(viewHeight * band.landing, safeBottom - height));
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const delta = focus.top - landing;
  if (scroller) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior });
  else window.scrollTo({ top: window.scrollY + delta, behavior });
}
