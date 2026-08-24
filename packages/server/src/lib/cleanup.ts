import { llmChat } from "./llm.ts";

export type CleanupChunkArgs = {
  text: string;
};

export type CleanupChunkFn = (args: CleanupChunkArgs) => Promise<string>;

export const cleanupChunk: CleanupChunkFn = async ({ text }) => {
  const system = [
    "You clean OCR and PDF-extraction artifacts out of a book chapter that will be read aloud by text-to-speech.",
    [
      "Remove:",
      "- lines of scanning garbage with no recoverable meaning (stray punctuation, isolated letters, symbol noise)",
      "- page headers, page footers, standalone page numbers, and dot leaders",
      "- footnote reference markers stranded in the text",
    ].join("\n"),
    [
      "Repair, only when the intended text is unambiguous:",
      '- words broken apart by spacing or OCR confusion (e.g. "F0 REWO R D" -> "FOREWORD", "w \' - WORLD" -> "WORLD")',
      "- words split by hyphenated line breaks",
      "- OCR character substitutions (0 for O, 1 for I, l for i, and similar) inside otherwise readable words",
    ].join("\n"),
    [
      "NEVER paraphrase, summarize, reorder, translate, modernize spelling, or add words of your own.",
      "Keep the original language exactly as written, including archaic orthography.",
      "Keep the paragraph structure (blank lines between paragraphs).",
      "If the entire input is unrecoverable garbage, output nothing at all.",
    ].join("\n"),
    "Output ONLY the cleaned text — no commentary, no quotes.",
  ].join("\n\n");

  // Reasoning occasionally runs long on garbled chunks — the 120s default times out
  return llmChat(system, text, { temperature: 0.3, allowEmpty: true, timeoutMs: 600_000 });
};
