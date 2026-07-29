import { deepseekChat } from "./deepseek.ts";

const MAX_CHUNK_CHARS = 2500;

export function splitForTranslation(text: string): string[] {
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

export type TranslateChunkArgs = {
  text: string;
  language: string;
  previousTranslation?: string;
};

export type TranslateChunkFn = (args: TranslateChunkArgs) => Promise<string>;

export const translateChunk: TranslateChunkFn = async ({ text, language, previousTranslation }) => {
  const system = [
    `You are a professional literary translator. Translate the user's text from its original language into ${language}.`,
    "Preserve the literary style, tone, and register. Keep dialogue natural and idiomatic, using the dialogue punctuation conventions of the target language.",
    "Keep character names consistent throughout.",
    previousTranslation
      ? `You are continuing a translation in progress. The tail of the translation so far (for continuity of names, terminology, and grammatical gender):\n\n${previousTranslation}`
      : "",
    "Output ONLY the translation, nothing else.",
  ].filter(Boolean).join("\n\n");

  return deepseekChat(system, text, { temperature: 1.3 });
};

export type TranslateTitleArgs = {
  title: string;
  language: string;
  translatedOpening?: string;
};

export type TranslateTitleFn = (args: TranslateTitleArgs) => Promise<string>;

export const translateTitle: TranslateTitleFn = async ({ title, language, translatedOpening }) => {
  const system = [
    `You are a professional literary translator. Translate the user's book chapter title into ${language}.`,
    translatedOpening
      ? `For consistent names and terminology, here is the translated opening of that chapter:\n\n${translatedOpening}`
      : "",
    "Output ONLY the translated title — no quotes, no explanation.",
  ].filter(Boolean).join("\n\n");

  const content = await deepseekChat(system, title, { temperature: 1.3 });
  return content.replace(/^["'«„“]+|["'»“”]+$/g, "").trim();
};
