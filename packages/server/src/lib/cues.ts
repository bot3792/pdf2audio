import type { SyncMap, SyncWord } from "./sync-map.ts";

// A highlight unit: a sentence where the engine timed words, else the whole (paragraph-sized) chunk.
// chunk is the sync-map chunk it came from, which is what ties a cue to a chunk preview.
export type Cue = { text: string; startMs: number; endMs: number; chunk: number; words?: SyncWord[] };
export type { CueGranularity } from "./reader-format.ts";
import type { CueGranularity } from "./reader-format.ts";
export type CueList = { granularity: CueGranularity; cues: Cue[] };

// Below this a cue reads as a flicker, so short fragments join their neighbour
const MIN_CUE_MS = 1200;
const SENTENCE_END = /[.!?…]+["'»”’)\]]*$/;

export function cuesFromSyncMap(map: SyncMap): CueList {
  const cues: Cue[] = [];
  let chunksWithWords = 0;

  for (const [index, chunk] of map.chunks.entries()) {
    if (chunk.words?.length) {
      chunksWithWords++;
      cues.push(...sentenceCues(chunk.words, index));
    } else {
      cues.push({ text: chunk.text, startMs: chunk.startMs, endMs: chunk.endMs, chunk: index });
    }
  }

  const granularity: CueGranularity =
    chunksWithWords === 0 ? "chunk" : chunksWithWords === map.chunks.length ? "word" : "sentence";
  return { granularity, cues };
}

function sentenceCues(words: SyncWord[], chunk: number): Cue[] {
  const groups: SyncWord[][] = [];
  let current: SyncWord[] = [];

  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.text) && spanMs(current) >= MIN_CUE_MS) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    const tooShortToStandAlone = groups.length > 0 && spanMs(current) < MIN_CUE_MS;
    if (tooShortToStandAlone) groups[groups.length - 1].push(...current);
    else groups.push(current);
  }

  return groups.map((group) => ({
    text: textOf(group),
    startMs: group[0].startMs,
    endMs: group[group.length - 1].endMs,
    chunk,
    words: group,
  }));
}

function spanMs(words: SyncWord[]): number {
  return words[words.length - 1].endMs - words[0].startMs;
}

function textOf(words: SyncWord[]): string {
  return words.map((word) => word.text + word.after).join("").trim();
}
