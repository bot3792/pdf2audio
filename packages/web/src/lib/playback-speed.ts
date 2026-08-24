// Reading speed is a standing preference, not something to re-pick every time a chapter opens —
// and it is one preference, shared by the reader and the chapter modal
const SPEED_KEY = "reader.speed";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function loadSpeed(): number {
  const stored = Number(localStorage.getItem(SPEED_KEY));
  return SPEEDS.includes(stored) ? stored : 1;
}

export function saveSpeed(rate: number): void {
  localStorage.setItem(SPEED_KEY, String(rate));
}
