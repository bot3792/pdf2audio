export type TransformPreset = {
  id: string;
  label: string;
  prompt: string;
  temperature: number;
  mode: "chunked" | "whole";
};

export const TRANSFORM_PRESETS: TransformPreset[] = [
  {
    id: "eli5",
    label: "ELI5",
    prompt:
      "Rewrite the user's book-chapter text so that a curious twelve-year-old could follow it. Keep every key idea, fact, and the original order; replace jargon with everyday words, break long sentences into short ones, and use concrete comparisons from daily life where they help. Do not skip content and do not add new claims.",
    temperature: 0.8,
    mode: "chunked",
  },
  {
    id: "shorten",
    label: "Shortened",
    prompt:
      "Condense the user's book-chapter text to roughly half its length. Keep the argument structure, key facts, the examples that carry weight, and the author's tone; cut repetition, asides, and filler. Do not introduce new ideas.",
    temperature: 0.6,
    mode: "chunked",
  },
  {
    id: "summary",
    label: "Summary",
    prompt:
      "Write a concise spoken summary of the user's book chapter, roughly 500-900 words. Cover the main argument or storyline, the key points in order, the strongest examples or evidence, and the conclusions. Refer to the author in the third person where relevant.",
    temperature: 0.7,
    mode: "whole",
  },
  {
    id: "enrich",
    label: "Enriched",
    prompt:
      "Rewrite the user's book-chapter text keeping all of its content and order, and enrich it: after each significant claim or concept, add a brief concrete example, analogy, or informal proof sketch that makes it easier to grasp. Weave the additions into the prose and keep them proportionate — the result should read as a richer version of the same chapter, not a commentary on it.",
    temperature: 0.9,
    mode: "chunked",
  },
];

export function getTransformPreset(id: string): TransformPreset | undefined {
  return TRANSFORM_PRESETS.find((p) => p.id === id);
}
