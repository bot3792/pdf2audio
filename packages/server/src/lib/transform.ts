import { llmChat, llmChatStream } from "./llm.ts";
import { translateChunk } from "./translate.ts";
import type { ChapterVariant } from "../schema.ts";

const MAX_CHUNK_CHARS = 2500;

export function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      push();
      let rest = paragraph;
      while (rest.length > MAX_CHUNK_CHARS) {
        const window = rest.slice(0, MAX_CHUNK_CHARS);
        const breakAt = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
        const cut = breakAt > MAX_CHUNK_CHARS / 2 ? breakAt + 1 : MAX_CHUNK_CHARS;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
      continue;
    }
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks;
}

export type TransformChunkArgs = {
  text: string;
  prompt: string;
  temperature?: number;
  previousOutput?: string;
  thinking?: boolean;
  model?: string;
  onDelta?: (delta: string) => void;
  onThinking?: (delta: string) => void;
};

export type TransformChunkFn = (args: TransformChunkArgs) => Promise<string>;

export const transformChunk: TransformChunkFn = async ({ text, prompt, temperature, previousOutput, thinking, model, onDelta, onThinking }) => {
  const system = [
    prompt,
    "The result will be read aloud by text-to-speech: write plain flowing prose — no markdown, no headings, no bullet points, no numbered lists.",
    previousOutput
      ? `You are continuing a rewrite in progress. The tail of the output so far (for continuity of terminology and flow):\n\n${previousOutput}`
      : "",
    "Output ONLY the rewritten text — no commentary, no quotes.",
  ].filter(Boolean).join("\n\n");

  // Reasoning can run long on dense chunks — the 120s default times out
  return llmChatStream(system, text, {
    model,
    temperature: temperature ?? 0.8,
    thinking,
    timeoutMs: 600_000,
    onDelta,
    onReasoning: onThinking,
  });
};

export type VariantChunkFn = (args: {
  text: string;
  previousOutput?: string;
  onDelta?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}) => Promise<string>;

export function variantChunkFn(variant: ChapterVariant): VariantChunkFn {
  const thinking = variant.params?.thinking ?? false;
  const model = variant.params?.model;
  if (variant.kind === "translation") {
    return ({ text, previousOutput, onDelta, onThinking }) =>
      translateChunk({ text, language: variant.key, previousTranslation: previousOutput, thinking, model, onDelta, onThinking });
  }
  if (!variant.prompt) throw new Error(`Transform variant "${variant.key}" has no prompt`);
  return ({ text, previousOutput, onDelta, onThinking }) =>
    transformChunk({
      text,
      prompt: variant.prompt!,
      temperature: variant.params?.temperature,
      previousOutput,
      thinking,
      model,
      onDelta,
      onThinking,
    });
}

export function chunksForVariant(source: string, variant: Pick<ChapterVariant, "params">): string[] {
  return variant.params?.mode === "whole" ? [source] : splitIntoChunks(source);
}

export function variantLabel(variant: Pick<ChapterVariant, "key" | "label">): string {
  return variant.label ?? variant.key;
}

export function variantKeySlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function inferVariantLabel(prompt: string): Promise<string> {
  const label = await llmChat(
    "The user wrote an instruction for rewriting book chapters. Name this transformation in 1-3 plain words (e.g. \"ELI5\", \"With proofs\", \"Noir retelling\"). Output ONLY the name — no quotes, no punctuation.",
    prompt,
    { temperature: 0.5 },
  );
  return label.replace(/^["'«„“]+|["'»“”]+$/g, "").trim().slice(0, 40);
}
