const MAX_NARRATOR_CHARS = 320;
const MIN_NARRATOR_CHARS = 120;

export function chunkTextForBulgarianNarrator(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_NARRATOR_CHARS) {
      chunks.push(paragraph);
      continue;
    }

    chunks.push(...chunkLongParagraph(paragraph));
  }

  return mergeShortTail(chunks);
}

function chunkLongParagraph(paragraph: string): string[] {
  const sentences = splitIntoSentences(paragraph);
  if (sentences.length === 1) {
    return splitByWords(paragraph);
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > MAX_NARRATOR_CHARS) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitByWords(sentence));
      continue;
    }

    if (!current) {
      current = sentence;
      continue;
    }

    const candidate = `${current} ${sentence}`;
    if (candidate.length <= MAX_NARRATOR_CHARS) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = sentence;
  }

  if (current) {
    chunks.push(current);
  }

  return mergeShortTail(chunks);
}

function splitIntoSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+(?:[.!?]+|$)/gu);
  if (!matches) return [paragraph];
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
      continue;
    }

    if (current) {
      chunks.push(current);
      current = word;
      continue;
    }

    chunks.push(word);
  }

  if (current) {
    chunks.push(current);
  }

  return mergeShortTail(chunks);
}

function mergeShortTail(chunks: string[]): string[] {
  if (chunks.length < 2) return chunks;

  const merged = [...chunks];
  const tail = merged.at(-1);
  const previous = merged.at(-2);
  if (!tail || !previous) return merged;

  if (tail.length >= MIN_NARRATOR_CHARS) return merged;

  const combined = `${previous} ${tail}`;
  if (combined.length <= MAX_NARRATOR_CHARS) {
    merged.splice(-2, 2, combined);
  }

  return merged;
}
