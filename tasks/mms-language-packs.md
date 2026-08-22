# Task: MMS language packs — on-demand voices for ~60 more languages

## Goal

Turn the hardcoded `bg-mms:bul` voice into a general **Meta MMS** engine: one downloadable
checkpoint per language, fetched on demand from the picker, exactly the way Pocket TTS languages
already work. One code path, ~63 usable languages instead of one.

## Why this is the cheap win

Everything needed already exists in the repo, hardcoded to Bulgarian:

- `scripts/synthesize_mms_tts.py` — `MODEL_ID = "facebook/mms-tts-bul"`, `VOICE_IDS = {"bul"}`.
  It already emits the chunk/progress/done JSON protocol and resumes from `--chunks-dir`.
- `lib/tts.ts` — a `bg-mms:` branch that dispatches to that script via `synthesizeChunkedBackend`.
- `lib/pocket-languages.ts` + `routes/pocket-voices.ts` + `voice-picker/PocketLanguageNotice.tsx` —
  a complete, working **download-a-language-on-demand** pattern: in-flight map, one network-allowed
  subprocess (`HF_HUB_OFFLINE: "0"`, the only place that escapes the offline invariant), no server
  restart because the download lands in the shared HF cache the synthesis subprocess reads at spawn.

MMS is the same shape as Pocket: one checkpoint per language, no runtime language switch. So the
plan is "make MMS a second citizen of the Pocket language mechanism", not "invent a mechanism".

## Verified facts (checked 2026-08-22, not assumed)

- **1140** `facebook/mms-tts-*` checkpoints exist on HF, keyed by **ISO 639-3** (`bul`, `deu`, `ukr`).
- **139 MB** of weights per language (`model.safetensors`). The current cache holds 277 MB for
  Bulgarian because both `model.safetensors` and `pytorch_model.bin` were pulled — the download
  path must pass `allow_patterns` to fetch safetensors + configs only.
- **63 of ~108** ISO-639-1 languages have an MMS checkpoint. Present: `ara asm bak ben bod bul cat
  cym deu div ell eng eus fao fas fin fra guj hat hau heb hin hun ind isl jav kan kaz khm kin kir
  lao lat lav lug mal mar mlg mon mya nld nya ory pan pol por ron rus som spa sqi swe swh tam tat
  tel tgk tha tur ukr vie yor zlm` (plus `amh kor`, see uroman below).
- **Missing** (verified 401 on the API, not a lookup slip): `ita jpn cmn/zho ces slk hrv srp dan nor
  afr zul et lt sl mk ms(→zlm) sw(→swh) …`. MMS is a **long-tail** corpus — it fills Bulgarian,
  Ukrainian, Greek, Turkish, Hebrew, Hindi, Persian, Vietnamese, Thai; it does **not** cover
  Italian/Japanese/Chinese/Czech, which Kokoro, Cartesia and macOS `say` already do. This engine
  complements the existing ones, it never replaces them.
- **Code mapping is not mechanical.** `sw → swh` (not `swa`), `ms → zlm` (not `msa`), `zh → nothing`.
  The 639-1 ↔ 639-3 table has to be generated and checked against the real repo list, not derived.
- **uroman**: only `amh` and `kor` of the candidate set set `is_uroman: true` in their tokenizer
  config (they need Latin romanization before tokenizing). Everything else is direct. Ship without
  them in v1; the flag is readable from the tokenizer config if we ever add `uroman`.
- **The vocab is brutal.** `mms-tts-bul` has a **37-token vocab: letters, space, `-`, `_`, `–`.
  No digits. No `.` `,` `!` `?`.** The tokenizer silently drops everything else. So MMS today reads
  "2026" as nothing at all, and has no sentence prosody whatsoever. See "Text shape" below — this is
  the single biggest quality lever, and it already affects the shipped Bulgarian voice.

## Design

### Voice ids

`mms:<iso3>` — `mms:bul`, `mms:deu`, `mms:ukr`. One voice per language (MMS is single-speaker).

`bg-mms:bul` stays valid as a **legacy alias** resolved in `parseTtsVoice`, the way bare
`pocket:<voice>` still means English. It is stored in `books.voice`, `chapters.synthesizedWith` and
`books.variantVoices` on real rows — no DB migration, just don't break it. The picker only ever
offers the new id.

### Server

- `lib/mms.ts` (new) — `MMS_LANGUAGES: { code, iso3, label, approxMb }[]` generated once from the
  HF list ∩ 639-1 table ∩ `is_uroman === false`, checked into the repo as a literal like
  `POCKET_LANGUAGES`; `mmsLanguageByCode`, `mmsModelId(iso3)`, `parseMmsVoice`,
  `mmsLanguageInstalled(iso3)` — the cache probe is simpler than Pocket's because each language is
  its own repo: `~/.cache/huggingface/hub/models--facebook--mms-tts-<iso3>/snapshots/*/model.safetensors`.
- `lib/mms-languages.ts` (new) — near-copy of `pocket-languages.ts`: `listMmsLanguages()`,
  `startMmsLanguageDownload()`, the same in-flight/failure maps, the same `HF_HUB_OFFLINE: "0"` spawn.
  *If it reads as pure duplication once written, extract the shared bits into a small
  `lib/model-downloads.ts` (in-flight registry + spawn + failure capture) and let both engines pass
  their own spawn args. Decide after the second copy exists, not before.*
- `routes/mms-voices.ts` (new) — `mmsVoices.languages` / `mmsVoices.downloadLanguage`, mirroring
  `pocket-voices.ts`, registered in `router.ts`.
- `scripts/synthesize_mms_tts.py` — replace `MODEL_ID`/`VOICE_IDS` with `--model facebook/mms-tts-<iso3>`
  passed from `lib/tts.ts` (validated server-side against the table, never user text), and add a
  `--cache-only` mode that downloads with `allow_patterns=["*.json","*.safetensors"]` and exits —
  the same contract `synthesize_pocket_tts.py` already offers.
- `lib/tts.ts` — the `bg-mms` engine becomes `mms`, dispatching with `extraArgs: ["--model", …]`.
  It stays *outside* `runExclusiveMlxSynthesis` (MMS is torch/MPS, not MLX) as it is today.
- `getPreviewTextForVoice` — currently every non-Kokoro/pocket/say/cartesia voice falls through to
  `BULGARIAN_PREVIEW_TEXT`. With 60 languages that is wrong for 59 of them: map `iso3 → iso1 →
  PREVIEW_TEXT_BY_LANGUAGE`. **`PREVIEW_TEXT_BY_LANGUAGE` has 8 entries.** Missing languages would
  fall back to the English sentence read by, say, the Thai model — which produces silence or noise,
  the exact failure the "previews say which language they are in" work was meant to kill. Either
  ship a sentence per language in the table, or refuse to preview a language with no sentence and
  say so in the row. Do not let it fall through to English.

### Web

- `lib/voices.ts` — add `"mms"` to `VoiceEngine` and to `ENGINE_PREFIXES` (`supportsSpeed: false`),
  `providerOfVoice` → `"Meta MMS"`, append to `PROVIDER_ORDER` **last** (quality order: it is the
  fallback, not the default), and add `mmsVoiceToEntry({ code, label })`. Drop the static
  `bg-mms:bul` row from `narratorVoices` — it becomes a dynamic entry like Pocket's.
- `VoiceLibraryModal.tsx` — MMS languages join `languageCounts` the way Pocket's do (uninstalled
  ones still get a rail row with the `↓` marker), and `MmsLanguageNotice.tsx` renders under the
  list when the selected language has an uninstalled MMS checkpoint.
- `MmsLanguageNotice.tsx` (new) — a copy of `PocketLanguageNotice` with MMS's numbers and an honest
  quality line ("robotic 16 kHz single speaker — coverage, not polish").

### Text shape — the part that actually decides whether this is good

The 37-token vocab means, for **every** MMS language:

1. **Punctuation is deleted before synthesis.** The only pause MMS ever produces is the 250 ms of
   silence `synthesize_mms_tts.py` inserts *between chunks*. So for MMS the chunker is the prosody:
   `chunkTextForBulgarianNarrator` packs 250–320 chars (tuned for the BG-MLX narrator, which
   over-generates on short input — an MLX quirk MMS does not share). MMS should chunk **per
   sentence** instead, so the pause lands where the period was. This is a real improvement to the
   already-shipped Bulgarian voice, independent of new languages.
2. **Digits are silently dropped.** "Chapter 12, 1943" reads as "Chapter , ". Options, cheapest
   first: (a) detect digits in the chapter text and warn in the picker/log; (b) expand numbers to
   words per language in `lib/normalizer.ts` before MMS synthesis; (c) let the existing DeepSeek
   cleanup lane do it. Start with (a) — the bug is invisible today, which is worse than it being
   unfixed.

## Phases

1. **Generalize the engine** — `mms:<iso3>` ids + legacy alias, `--model` on the Python script,
   `lib/mms.ts` with the generated table, tests renamed off `bg-mms`. Bulgarian keeps working
   through the new path. No UI change yet.
2. **Sentence chunking + digit warning for MMS** — fixes the shipped Bulgarian voice on its own.
3. **Download-on-demand** — `--cache-only`, `lib/mms-languages.ts`, the tRPC route, the picker
   notice, rail rows for uninstalled languages.
4. **Preview sentences** — one per shipped language, or the explicit "no preview" state.
5. **Docs** — the engines table in `AGENTS.md` (the `bg-mms` row becomes the MMS row), `README.md`,
   and `docs/tts-licensing.md` (MMS weights are **CC-BY-NC 4.0** — same noncommercial bucket the
   licensing doc already tracks; the doc says NC voices stay while this is noncommercial).

## Open questions

- **Rail size.** Adding ~60 mostly-uninstalled languages roughly doubles the language rail, and most
  new rows would show `↓` with no voices behind them. Keep them always visible (the rail is the
  "what can read my book" axis, so an answer of "download this" is a real answer), or hide
  uninstalled MMS languages behind the existing "Show all N languages" expansion? Leaning: always
  visible, because a language you cannot see you cannot request.
- **How many to ship.** All 63, or the ~25 that a book is plausibly written in? The table is
  generated, so 63 costs nothing but rail length — and the long tail is the entire point of MMS.
- **Same pattern, better models.** Piper (`rhasspy/piper-voices`, ONNX, ~60 MB/voice, several voices
  per language, markedly better prosody than MMS because it keeps punctuation) fits this exact
  registry-plus-download abstraction and covers ~50 languages including the ones MMS misses
  (Italian, Czech, Slovak, Serbian, Danish, Norwegian). If phase 3 lands cleanly, Piper is the
  natural second tenant of `lib/model-downloads.ts` — and probably the better default for any
  language both engines cover. Worth its own task file rather than scope creep here.
