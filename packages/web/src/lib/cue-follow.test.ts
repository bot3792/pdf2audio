import { describe, expect, it } from "vitest";

import { followDelta, type FollowBand } from "./cue-follow.ts";

const BAND: FollowBand = { top: 100, bottom: 100, landing: 0.3 };
const VIEW = 1000;

const span = (top: number, height: number) => ({ top, bottom: top + height });

describe("followDelta", () => {
  it("leaves a cue that sits inside the safe area alone", () => {
    expect(followDelta(span(300, 60), null, VIEW, BAND, false)).toBeNull();
  });

  it("moves a cue whose tail crosses the bottom edge even though it starts inside", () => {
    // The bug the scrolloff fixed: the top is well within the band, the last line is not
    const delta = followDelta(span(700, 250), null, VIEW, BAND, false);
    expect(delta).toBe(700 - 300);
  });

  it("moves a cue that has scrolled off the top", () => {
    expect(followDelta(span(40, 60), null, VIEW, BAND, false)).toBe(40 - 300);
  });

  it("lands a cue at the landing spot, leaving room below for what comes next", () => {
    const delta = followDelta(span(950, 60), null, VIEW, BAND, false)!;
    expect(950 - delta).toBe(VIEW * BAND.landing);
  });

  it("clamps the landing so a tall cue's own tail is not pushed past the bottom", () => {
    const cue = span(950, 700);
    const landed = 950 - followDelta(cue, null, VIEW, BAND, false)!;
    expect(landed).toBe(VIEW - BAND.bottom - 700);
    expect(landed).toBeGreaterThanOrEqual(BAND.top);
  });

  it("follows the word once the cue is taller than the safe area", () => {
    // 900pt of cue cannot fit in an 800pt safe area, so the word is what has to stay visible —
    // and the cue's own top, far above the fold, would say nothing needs to move
    const cue = span(-200, 900);
    const word = span(920, 40);
    expect(followDelta(cue, word, VIEW, BAND, false)).toBe(920 - 300);
  });

  it("stays put while the word inside an over-tall cue is still in the safe area", () => {
    expect(followDelta(span(-200, 900), span(400, 40), VIEW, BAND, false)).toBeNull();
  });

  it("falls back to the cue's own top when an over-tall cue has no word", () => {
    expect(followDelta(span(-200, 900), null, VIEW, BAND, false)).toBe(-200 - 300);
  });

  it("pins the focus to the top edge when the safe area is smaller than the focus itself", () => {
    const tight: FollowBand = { top: 24, bottom: 90, landing: 0.25 };
    const view = 128;
    const word = span(60, 33);
    const landed = 60 - followDelta(span(0, 300), word, view, tight, false)!;
    expect(landed).toBe(tight.top);
  });

  it("repositions on a jump even when the cue is already where it belongs", () => {
    expect(followDelta(span(300, 60), null, VIEW, BAND, true)).toBe(0);
  });
});
