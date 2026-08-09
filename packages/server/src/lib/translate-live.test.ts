import { describe, expect, it } from "vitest";
import {
  beginTranslationLive,
  liveTranslationState,
  subscribeTranslationLive,
  type TranslationLiveEvent,
} from "./translate-live.ts";

describe("translation live channel", () => {
  it("delivers snapshot, deltas, and status to subscribers", () => {
    const id = crypto.randomUUID();
    const events: TranslationLiveEvent[] = [];
    const unsubscribe = subscribeTranslationLive(id, (e) => events.push(e));

    const live = beginTranslationLive(id, "start");
    live.append(" more");
    live.sync("start more (canonical)");
    live.end("done");
    unsubscribe();

    expect(events).toEqual([
      { type: "snapshot", text: "start" },
      { type: "delta", text: " more" },
      { type: "snapshot", text: "start more (canonical)" },
      { type: "status", status: "done" },
    ]);
  });

  it("tracks the accumulated live text until the session ends", () => {
    const id = crypto.randomUUID();
    const live = beginTranslationLive(id, "a");
    live.append("b");
    expect(liveTranslationState(id)).toEqual({ text: "ab", thinking: "" });
    live.end("suspended");
    expect(liveTranslationState(id)).toBeNull();
  });

  it("accumulates thinking and clears it when translated text arrives", () => {
    const id = crypto.randomUUID();
    const events: TranslationLiveEvent[] = [];
    subscribeTranslationLive(id, (e) => events.push(e));

    const live = beginTranslationLive(id, "");
    live.think("hmm ");
    live.think("names...");
    expect(liveTranslationState(id)).toEqual({ text: "", thinking: "hmm names..." });

    live.append("Превод");
    expect(liveTranslationState(id)).toEqual({ text: "Превод", thinking: "" });
    live.end("done");

    expect(events).toEqual([
      { type: "snapshot", text: "" },
      { type: "thinking", text: "hmm " },
      { type: "thinking", text: "names..." },
      { type: "delta", text: "Превод" },
      { type: "status", status: "done" },
    ]);
  });

  it("skips redundant snapshots when sync matches the live text", () => {
    const id = crypto.randomUUID();
    const events: TranslationLiveEvent[] = [];
    subscribeTranslationLive(id, (e) => events.push(e));

    const live = beginTranslationLive(id, "");
    live.append("same");
    live.sync("same");
    live.end("done");

    expect(events.filter((e) => e.type === "snapshot")).toHaveLength(1);
  });

  it("ignores a stale handle after a newer run begins", () => {
    const id = crypto.randomUUID();
    const stale = beginTranslationLive(id, "old");
    const fresh = beginTranslationLive(id, "new");

    const events: TranslationLiveEvent[] = [];
    subscribeTranslationLive(id, (e) => events.push(e));

    stale.append("!");
    stale.end("failed", "boom");
    expect(events).toEqual([]);
    expect(liveTranslationState(id)?.text).toBe("new");

    fresh.append("!");
    expect(liveTranslationState(id)?.text).toBe("new!");
    fresh.end("done");
    expect(liveTranslationState(id)).toBeNull();
  });

  it("includes the error on failed status", () => {
    const id = crypto.randomUUID();
    const events: TranslationLiveEvent[] = [];
    subscribeTranslationLive(id, (e) => events.push(e));

    beginTranslationLive(id, "").end("failed", "API down");

    expect(events.at(-1)).toEqual({ type: "status", status: "failed", error: "API down" });
  });
});
