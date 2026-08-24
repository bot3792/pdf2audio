import { llmChat, llmChatStream } from "./llm.ts";

export type TranslateChunkArgs = {
  text: string;
  language: string;
  previousTranslation?: string;
  thinking?: boolean;
  model?: string;
  onDelta?: (delta: string) => void;
  onThinking?: (delta: string) => void;
};

export type TranslateChunkFn = (args: TranslateChunkArgs) => Promise<string>;

export const translateChunk: TranslateChunkFn = async ({ text, language, previousTranslation, thinking, model, onDelta, onThinking }) => {
  const system = [
    `You are a professional literary translator. Translate the user's text from its original language into ${language}.`,
    "Preserve the literary style, tone, and register. Keep dialogue natural and idiomatic, using the dialogue punctuation conventions of the target language.",
    "Keep character names consistent throughout.",
    previousTranslation
      ? `You are continuing a translation in progress. The tail of the translation so far (for continuity of names, terminology, and grammatical gender):\n\n${previousTranslation}`
      : "",
    "Output ONLY the translation, nothing else.",
  ].filter(Boolean).join("\n\n");

  // Reasoning can run long on dense chunks — the 120s default times out
  return llmChatStream(system, text, { model, temperature: 1.3, thinking, timeoutMs: 600_000, onDelta, onReasoning: onThinking });
};

export type TranslateTitleArgs = {
  title: string;
  language: string;
  translatedOpening?: string;
  thinking?: boolean;
  model?: string;
};

export type TranslateTitleFn = (args: TranslateTitleArgs) => Promise<string>;

export const translateTitle: TranslateTitleFn = async ({ title, language, translatedOpening, thinking, model }) => {
  const system = [
    `You are a professional literary translator. Translate the user's book chapter title into ${language}.`,
    translatedOpening
      ? `For consistent names and terminology, here is the translated opening of that chapter:\n\n${translatedOpening}`
      : "",
    "Output ONLY the translated title — no quotes, no explanation.",
  ].filter(Boolean).join("\n\n");

  const content = await llmChat(system, title, { model, temperature: 1.3, thinking, timeoutMs: 600_000 });
  return content.replace(/^["'«„“]+|["'»“”]+$/g, "").trim();
};
