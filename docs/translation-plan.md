# Translation — state of play and next steps

Branch: `translation` (based on `main`). Everything below is committed and green:
`pnpm build` passes, `pnpm test` in `packages/server` passes (115 tests).

## What is already built

| Commit | What |
| --- | --- |
| `fb84965` | Translation v1: schema, DeepSeek provider, worker, side-by-side modal |
| `8db3750` | Dual-language output: per-language audio + assemblies + book view |
| `5d70786` | Language-aware ChapterModal (chunk previews for translations) |
| _uncommitted_ | Shared language list (`packages/web/src/lib/languages.ts`, 33 languages incl. Russian, Hebrew, Arabic, Japanese…) wired into `TranslationModal` |

### Data model

- **`chapter_translations`** — unique on `(chapter_id, language)`, `ON DELETE CASCADE` from `chapters`.
  - Text: `text`, `status` (pending/translating/done/failed/suspended), `progress` (`"n/m"` chunks), `error`, `source_hash`.
  - Audio: `audio_path`, `audio_status`, `audio_progress`, `audio_duration_ms`, `audio_error`, `synthesized_with`.
- **`books.translation_language`** — last language picked (UI default only).
- **`assemblies.language`** — `null` = original, otherwise the language.
- Original chapter text is never modified. Chunk identity is still filesystem-based (no chunk rows).

### Server

- `lib/translate.ts` — `splitForTranslation` (≤2500 chars, paragraph/sentence boundaries, deterministic) and `translateChunk` (DeepSeek `deepseek-v4-flash`, `DEEPSEEK_API_KEY` from root `.env`, optional).
  Each call is stateless: system prompt + last 1500 chars of translation-so-far for continuity + the source chunk. Context can't grow.
- `workers/translate.ts` — per-chunk incremental save; **the chunk write is the cancel check** (`WHERE status != 'suspended' RETURNING` → 0 rows = stopped). Resume needs matching chunk count **and** `source_hash`.
- `workers/synthesize-translation.ts` — mirrors `synthesize.ts` but reads the translation row (**errors if `status != 'done'`, never falls back to the original text**), writes audio to `output/{book}/{lang-slug}/chNNN.mp3` and chunk previews to `chunks/{lang-slug}/chNNN/`, auto-queues per-language assembly.
- `workers/assemble.ts` — optional `language`; picks audio from translation rows, names the file `..._{lang}_{ts}.mp3`, sets `assemblies.language`; only the original path updates `books.output_path`.
- `routes/translations.ts` — `get`, `detail` (adds chunk previews + hover ranges), `listForBook`, `languages`, `start`, `stop`, `queueAudio`, `processSelectedAudio`, `stopAudio`, `assemble`.
- `GET /audio/translation/:translationId` serves per-language chapter audio.

### Web

- **BookDetail** — language pills (`Original | Bulgarian (2/201) | …`), blue banner while a language view is active, chapter rows swapped to the translation's stats/status/audio with **no fallback**; untranslated rows are unselectable; toolbar actions and the assemblies list are language-scoped.
- **ChapterModal** — with `language` set, loads `translations.detail`: translated text, that language's chunk previews with click/hover highlighting, per-language audio. No Edit button, no view-mode tabs, PDF link disabled.
- **TranslationModal** — original vs. translation side by side, 1s polling, start/stop/resume/re-translate.

## Verified end to end

Translate → stop mid-run (partial kept) → resume (seamless continuity) → synthesize Bulgarian with `bg-mms:bul` (5:03 audio) → Bulgarian assembly row + file. Test data lives on the Brothers Grimm book (`36f42d65-…`), chapter "37 The Old Woman in the Forest".

---

## Next session — the three asks

### 1. Translate from inside the chapter modal (highest value)

Today: to translate a chapter you must leave the language view, open TranslationModal from Original, translate, switch back, reopen. Fix so a chapter modal opened in a language view can drive translation directly.

- Pass `bookId` into `ChapterModal` (`ChapterTable` already receives it and currently ignores it — see the unused-var warning).
- In language mode add a **Translate / Stop / Re-translate** control next to Re-synthesize, calling `trpc.translations.start` / `.stop` with `{chapterId, language}` (mutations already exist).
- Poll while translating: `translations.detail` `refetchInterval` should be 1000 when `status` is `translating`/`pending` (currently only keys off `chapter.status === "synthesizing"`), so translated text streams into the modal the way chunks do.
- Untranslated chapters currently render "No Bulgarian translation yet" — that empty state should host the Translate button.

### 2. Stack the comparison modal on top of the chapter modal

- Add a **Compare** button in ChapterModal (language mode) that renders `TranslationModal` as a child overlay with `initialChapterId` (the prop exists) and `initialLanguage`.
- Closing it returns to the chapter modal — because it's a child, that's just local state; make sure the Escape handler closes only the top modal (ChapterModal's key handler must ignore Escape while the child is open, same pattern it already uses for `pdfPage`).

### 3. Languages — done, needs commit

`packages/web/src/lib/languages.ts` now lists 33 languages including **Russian and Hebrew**. It's wired into TranslationModal and builds clean; just commit it.

---

## Known gaps / decisions parked

- **No manual editing of translated text.** Originals have `custom_text`; translations can only be regenerated. Adding a `custom_text` column on `chapter_translations` + an Edit button is the natural follow-up (would also need the source-hash logic to leave hand edits alone).
- **No per-book glossary.** The Къртицата gender/name decisions can't be pinned. Plan: a `glossary` text field on the book (or per language) injected into the system prompt.
- **No bulk "translate all chapters"** — only per chapter. A `processSelectedTranslations` mutation mirroring `processSelectedAudio` is straightforward.
- **Chunk-block streaming, not token streaming.** Text lands one ~2500-char chunk at a time. For a live-typing feel: consume DeepSeek SSE and flush to a **separate `partial_text` column** every ~300ms, render `text + partial`, fold into `text` on chunk completion. Keeping partials out of `text` is what preserves stop/resume safety.
- **Chapter selection is shared** between the original and language views (one `chapters.selected` flag). Per-language selection would need a column on the translation row.
- **Voice is book-level.** Switch the voice before synthesizing a language (e.g. `bg-mms:bul` for Bulgarian). Per-language voice would be a `voice` column on the translation row or a book-language settings table.
- **Re-slicing chapters wipes translations** (FK cascade). Intended — the source texts change — but worth a confirm dialog mentioning it.
- **Chunk-text hover ranges are partial** (9/15 on the test chapter) because the TTS chunker rewrites text (number expansion). Same limitation as the original view.

## Conventions worth remembering

- Never hand-write migrations: `pnpm db:generate` then `pnpm db:migrate`.
- Tests use a real Postgres template DB; add new tables to `resetDb` in `packages/server/test/setup.ts` (already done). Mock the queue/filesystem, never Drizzle.
- New tables need `DELETE` in `resetDb` in FK order.
- Cancellation everywhere is cooperative: a status flip in the DB plus `DELETE FROM graphile_worker._private_jobs … AND run_at > now()`.
