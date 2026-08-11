# Translation — state of play and next steps

> **Historical (July 2026).** Superseded on 2026-08-11: translation infra was generalized into chapter *variants* (translations + AI rewrites — ELI5/shorten/summary/enrich/custom prompts). See AGENTS.md; the tRPC router is `variants`, the modal is `VariantModal`, the chunker is `lib/transform.ts` `splitIntoChunks`.

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

## The three asks — all done

1. **Translate from inside the chapter modal** — in language mode ChapterModal has Translate/Resume/Retry/Re-translate + Stop next to Re-synthesize (`trpc.translations.start`/`.stop`), `translations.detail` polls at 1s while `pending`/`translating` so text streams in, and the untranslated empty state hosts its own Translate button.
2. **Comparison modal stacks on the chapter modal** — a Compare button renders `TranslationModal` as a child overlay (`initialChapterId` + `initialLanguage`); ChapterModal's key handler ignores Escape/arrows while it's open, and closing it invalidates the translation queries.
3. **Language list** — committed in `3e043bb` (33 languages incl. Russian and Hebrew, wired into TranslationModal).

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
- Cancellation everywhere is cooperative: a status flip in the DB plus deleting unlocked queued jobs (join `_private_tasks` on `task_id` — the jobs table has no `task_identifier` column).
- Jobs run with `maxAttempts: 1`, so a server death mid-job used to strand rows in `translating`/`synthesizing` forever. `workers/sweep.ts` now runs at boot: it purges dead jobs (exhausted or orphan-locked) and requeues stranded rows with resume.
