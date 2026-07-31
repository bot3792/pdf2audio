export type AiPresetSubject = "chapter" | "chapters" | "book";

export type AiPreset = {
  key: string;
  label: string;
  prompt: (subject: AiPresetSubject) => string;
};

const subjectPhrase: Record<AiPresetSubject, string> = {
  chapter: "this chapter",
  chapters: "these chapters",
  book: "this book",
};

// The Summarize default mirrors Brave Leo's page-summary prompt
export const AI_PRESETS: AiPreset[] = [
  {
    key: "summarize",
    label: "Summarize",
    prompt: (s) =>
      `Provide a concise list of up to 6 bullets on the most important points of ${subjectPhrase[s]}, followed by a one-paragraph summary.`,
  },
  {
    key: "questions",
    label: "Suggest questions",
    prompt: (s) =>
      `List 8 insightful questions a curious reader could ask about ${subjectPhrase[s]}. Only list the questions — I will pick one to ask next.`,
  },
  {
    key: "explain",
    label: "Explain simply",
    prompt: (s) => `Explain the main ideas and argument of ${subjectPhrase[s]} in plain, simple language.`,
  },
  {
    key: "entities",
    label: "People & terms",
    prompt: (s) =>
      `List the key people, places, and terms mentioned in ${subjectPhrase[s]}, each with a one-line description of who or what they are.`,
  },
];

export const AI_MODELS = [
  { key: "flash", label: "V4 Flash", hint: "Fast and cheap — good default", contextTokens: 1_000_000 },
  { key: "pro", label: "V4 Pro", hint: "Flagship reasoning model — slower, for harder questions", contextTokens: 1_000_000 },
] as const;

export type AiModelKey = (typeof AI_MODELS)[number]["key"];

// No DeepSeek tokenizer here — deliberately pessimistic BPE rule of thumb
// (~3.4 chars/token for ASCII, ~1.4 for non-Latin scripts) so estimates overestimate.
export function estimateTokensFromCounts(ascii: number, nonAscii: number): number {
  return Math.round(ascii / 3.4 + nonAscii / 1.4);
}

export function estimateTokens(text: string): number {
  const nonAscii = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  return estimateTokensFromCounts(text.length - nonAscii, nonAscii);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${parseFloat((n / 1_000_000).toFixed(2))}M`;
}
