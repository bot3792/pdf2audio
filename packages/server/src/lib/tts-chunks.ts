const MAX_NARRATOR_CHARS = 320;
// The narrator model (raditotev/bg-tts-v5-mlx, speaker 1) emits a roughly fixed ~20–24s of audio
// per chunk regardless of input length, so chunks shorter than its 250–320 char sweet spot come
// out padded with mumble/repetition. We therefore pack text toward this midpoint and balance the
// chunks so none is needlessly short — merging across paragraph/sentence boundaries as needed.
const IDEAL_NARRATOR_CHARS = 285;

export function chunkTextForBulgarianNarrator(text: string): string[] {
  // Collapse all whitespace (including paragraph breaks) so packing can merge across them.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const units = toUnits(normalized);
  if (units.length === 0) return [];

  return balancePartition(units);
}

// Split into the smallest natural units we won't break further: whole sentences, or — for a single
// sentence longer than the cap — word-level pieces that each fit.
function toUnits(text: string): string[] {
  const units: string[] = [];
  for (const sentence of splitIntoSentences(text)) {
    if (sentence.length <= MAX_NARRATOR_CHARS) {
      units.push(sentence);
    } else {
      units.push(...splitByWords(sentence));
    }
  }
  return units;
}

function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+(?:[.!?]+|$)/gu);
  if (!matches) return [text];
  return matches.map((part) => part.trim()).filter(Boolean);
}

function splitByWords(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= MAX_NARRATOR_CHARS) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = word; // a single word longer than the cap is kept whole (rare)
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

// Group consecutive units into the fewest chunks needed to stay near the ideal size, then split
// them as evenly as possible so we never leave a tiny leftover chunk at the end.
function balancePartition(units: string[]): string[] {
  const lengths = units.map((u) => u.length);
  const totalChars = chunkLength(lengths);

  const numChunks = Math.max(
    1,
    Math.ceil(totalChars / MAX_NARRATOR_CHARS),
    Math.round(totalChars / IDEAL_NARRATOR_CHARS),
  );

  // Can't fit more chunks than units (units are indivisible here) — emit each on its own.
  if (numChunks >= units.length) return [...units];

  const capacity = minMaxCapacity(lengths, numChunks);
  return packToCapacity(units, capacity);
}

// Length of a chunk made of these units joined by single spaces.
function chunkLength(lengths: number[]): number {
  if (lengths.length === 0) return 0;
  return lengths.reduce((sum, len) => sum + len, 0) + (lengths.length - 1);
}

// Smallest per-chunk capacity that lets the units fit in at most `numChunks` chunks (binary search
// on the classic "split array to minimize the largest part" — yields evenly balanced chunks).
function minMaxCapacity(lengths: number[], numChunks: number): number {
  let lo = Math.max(...lengths); // a chunk must hold at least its largest single unit
  let hi = chunkLength(lengths); // everything in one chunk

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (chunksNeeded(lengths, mid) <= numChunks) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

function chunksNeeded(lengths: number[], capacity: number): number {
  let count = 1;
  let current = 0;

  for (const len of lengths) {
    const candidate = current === 0 ? len : current + 1 + len;
    if (candidate <= capacity) {
      current = candidate;
    } else {
      count += 1;
      current = len;
    }
  }

  return count;
}

function packToCapacity(units: string[], capacity: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= capacity) {
      current = candidate;
    } else {
      chunks.push(current);
      current = unit;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
