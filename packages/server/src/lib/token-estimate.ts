// Mirrors the web modal's estimate: no DeepSeek tokenizer, deliberately pessimistic
// BPE rule of thumb (~3.4 chars/token ASCII, ~1.4 non-Latin) so guards overestimate.
export const MODEL_CONTEXT_TOKENS = 1_000_000;

export function countAsciiNonAscii(text: string): { ascii: number; nonAscii: number } {
  const nonAscii = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  return { ascii: text.length - nonAscii, nonAscii };
}

export function estimateTokensFromCounts(ascii: number, nonAscii: number): number {
  return Math.round(ascii / 3.4 + nonAscii / 1.4);
}

export function estimateTokens(text: string): number {
  const { ascii, nonAscii } = countAsciiNonAscii(text);
  return estimateTokensFromCounts(ascii, nonAscii);
}
