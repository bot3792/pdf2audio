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

export function followCue(force: boolean, band: FollowBand): void {
  watchGestures();
  if (!force && Date.now() - lastGesture < PAUSE_MS) return;

  const target = document.querySelector('[data-testid="cue-rect"], [data-testid="text-cue-active"]');
  if (!target) return;

  const scroller = scrollParent(target);
  const box = target.getBoundingClientRect();
  const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
  const top = box.top - viewTop;

  // Only move when the cue has left the band, then land it high enough that the next several
  // cues fit below — following along should scroll in stretches, not on every sentence
  if (!force && top >= band.top && top <= viewHeight - band.bottom) return;

  const delta = top - viewHeight * band.landing;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (scroller) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior });
  else window.scrollTo({ top: window.scrollY + delta, behavior });
}
