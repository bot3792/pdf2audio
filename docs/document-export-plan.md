# Document export (PDF/EPUB) — handoff plan

Goal: book-level action "assemble document from selected chapters" so a book can be
turned from one language into another as a readable file. Works in both views: in a
language view it renders the translated text, in the original view the source text.

## Decisions already made

- **Renderer: Vivliostyle CLI** (Node-native, actively maintained, Node 20+). It fills
  the one gap Chromium print still has — `target-counter`, i.e. TOC entries with real
  page numbers — and outputs **EPUB from the same HTML input**. Chromium natively
  supports `@page` margin boxes + page counters since late 2024, so plain Playwright
  `page.pdf()` is the documented fallback (same HTML, TOC just loses page numbers).
  Rejected: WeasyPrint (Python, second-class in the TS worker), Typst (new toolchain +
  markup escaping), PrinceXML (commercial), pdfkit/react-pdf (hand-rolled pagination).
- **Chapters render as discrete units** — translated `<h1>` title + body paragraphs.
  No LLM "gluing" between chapters (explicitly decided against feeding PDF pages to
  DeepSeek; faithful rendering, not editorial rewriting).
- **Title dedup rule**: the chapter title often repeats as the body's first line.
  Detect on the ORIGINAL side (normalize + compare `chapters.title` vs the first
  line(s) of the source text); when matched, drop the first line of the translated
  body at render time. Deterministic — no LLM involved.
- Translated titles are DONE: `chapter_translations.title` is filled by the translate
  worker on completion and by the `translateTitles` backfill worker (button in the
  language-view banner).

## Implementation sketch

1. `assembleDocument` worker (extraction pool, like `assemble`): payload
   `{ bookId, language?, format: "pdf" | "epub" }`. Pulls selected chapters in order;
   in a language view uses `chapter_translations.text`/`.title` (require status=done,
   mirror the audio-assemble selection rule), else `customText ?? cleanText ?? rawText`
   and `chapters.title`.
2. Build one HTML file (+ CSS for @page size/margins, running headers, TOC via
   `target-counter`) in the book's output dir, run Vivliostyle CLI on it.
3. Store the artifact like audio assemblies (an `assemblies`-like row or new
   `documents` table — check how `assemblies.language`/`outputPath` work and mirror;
   download route like `/download/assembly/:id`).
4. UI: button next to "Assemble selected" in BookDetail, same selection/disabled
   conventions (buttons disabled-not-hidden, tooltips).

## Spike first (judge on real material)

Test book: `2c29b696-a110-483a-9cbe-4c6acc69c530` — 19 English chapters, all done,
all with translated titles (source is garbled-OCR Russian, good stress test).
Questions the spike must answer:
- Cyrillic + English hyphenation quality (inherits Chromium dictionaries)
- behavior on the 208-page pseudo-chapter (ch 16, ~420k chars)
- render time + memory for a full book
- EPUB output quality from the same input

## Related state (already shipped, 2026-07-27/28)

- Chapter table shows live `translating` progress; DeepSeek calls have 120s timeout
  and `err.cause` surfaced; `run_token` fencing prevents duplicate translate runs.
- Parked nearby ideas: per-book glossary for name/term consistency (also rides
  DeepSeek prefix cache); prompt reorder + `prompt_cache_hit_tokens` logging;
  splitting the ch-16 pseudo-chapter in the structure modal (3x parallel translation).
