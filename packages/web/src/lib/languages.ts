export const TRANSLATION_LANGUAGES = [
  "Arabic",
  "Bulgarian",
  "Chinese (Simplified)",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Finnish",
  "French",
  "German",
  "Greek",
  "Hebrew",
  "Hindi",
  "Hungarian",
  "Indonesian",
  "Italian",
  "Japanese",
  "Korean",
  "Norwegian",
  "Persian",
  "Polish",
  "Portuguese",
  "Romanian",
  "Russian",
  "Serbian",
  "Slovak",
  "Slovenian",
  "Spanish",
  "Swedish",
  "Turkish",
  "Ukrainian",
  "Vietnamese",
] as const;

// The book's own language, offered as codes because voices are keyed by code. Derived from the
// translation list so the two stay in step.
import { languageCodeFromName } from "./voices.ts";

export const BOOK_LANGUAGE_OPTIONS: { code: string; label: string }[] = TRANSLATION_LANGUAGES
  .map((label) => ({ code: languageCodeFromName(label), label: label as string }))
  .filter((entry) => entry.code !== null)
  .map((entry) => ({ code: entry.code!, label: entry.label }))
  .sort((a, b) => a.label.localeCompare(b.label));
