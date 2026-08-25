# Task: ElevenLabs as a narration engine

## Goal

Add **ElevenLabs** to the engine registry beside `say:`, `cartesia:`, Kokoro, Pocket and the
narrators, reached through an `elevenlabs:` voice prefix.

The reason is not breadth — we have 500+ voices already. It is that the demo book, the website
and the intro videos are all narrated by whatever engine we point at them, and right now the best
we can offer a stranger is Kokoro. This is the engine you use for **the handful of things other
people will hear**, which also bounds what it may cost.

`ENGINE_PREFIXES` is the one table a new engine has to join.

## Verified facts (checked 2026-08-25)

**Word timings: yes — and in a better shape than Cartesia's.**
`POST /v1/text-to-speech/{voice_id}/with-timestamps` returns JSON:

```jsonc
{
  "audio_base64": "…",
  "alignment": {
    "characters": ["H", "e", "l", "l", "o", " ", "t", "h", "e", "r", "e"],
    "character_start_times_seconds": [0.0, 0.058, …],
    "character_end_times_seconds":   [0.058, 0.116, …]
  },
  "normalized_alignment": { … }
}
```

Character-level, not word-level. That is an advantage here, not a shortfall: `ChunkWord` is
`{ text, after, startMs, endMs }`, and grouping characters on whitespace produces both the word
**and the exact spacing that rejoins it into the spoken text**. Cartesia hands back parallel word
arrays with the spacing discarded, which is why `toChunkWords` hardcodes `after: " "`.

**Use `alignment`, never `normalized_alignment`.** The normalized one describes the text after
"Dr." became "Doctor" and "1943" became words. Our cue text has to be findable in `cleanText` by
`locateChunks` or the chapter loses its rectangles — the entire read-along layer depends on the
spoken string being the printed string.

**Cost: the first voice here with a price per book.** Roughly 513,000 characters in a ten-hour
audiobook (~90,000 words at ~5.7 characters each):

| model | languages | max chars/request | list overage | a 10-hour book |
| --- | --- | --- | --- | --- |
| `eleven_multilingual_v2` | 29 | 10,000 | $0.10 / 1k chars | **~$51** |
| `eleven_flash_v2_5` | 32 | 40,000 | $0.05 / 1k chars | **~$26** |
| `eleven_v3` | 70+ | 5,000 | — | not usable, see below |

The Creator plan is $22/month for 121,000 credits ≈ 1 credit per character ≈ **2.4 hours of
multilingual audio a month**. So: one demo book is a reasonable one-off; a library is not. Every
other engine in this repo is free and local, and that stays true — this is an opt-in lane.

**Other facts that shape the code:**

- **`pcm_44100` requires the Pro tier**; `pcm_24000` is available on every tier including free.
  Fix the engine at 24 kHz mono rather than making the audio format depend on someone's plan.
  `pcm16WavHeader` (already exported from `lib/cartesia.ts`) takes the sample rate as an argument.
- **Concurrency is 2 (free) / 3 (Starter) / 5 (Creator) / 10 (Pro)** parallel requests. We
  synthesize chunks sequentially, so this never binds — but it rules out "just fan out the book".
- **Voices are `GET /v2/voices`**, cursor-paginated with `page_size` (max 100) and
  `next_page_token`, `has_more` to continue. Each voice carries `voice_id`, `name`, `category`
  (premade / professional / cloned / famous), `labels` (accent, gender, …), `description` and
  `verified_languages`. Close enough to Cartesia's shape that `fetchAllCartesiaVoices` is the
  template, with `next_page_token` where Cartesia has `starting_after`.
- **`eleven_v3` is not on the with-timestamps endpoint's model list.** Confirm before offering it,
  and if it is genuinely absent, do not offer it at all: a v3 chapter would come back with no
  timings, fall to `granularity: "chunk"`, and highlight a whole paragraph at a time. The best
  voice in the catalogue is worth nothing to this project if the page cannot follow it.

## Design

### Chunking and cost

Reuse `NARRATOR_CHUNKS` (the 320-character pack) exactly as Cartesia does. It keeps chunk previews
comparable across engines and keeps the resume unit small, which matters far more for a paid engine
than a free one: **a chunk already on disk is never re-requested, so a dev-server restart in the
middle of a $50 book costs nothing.** That is `readChunkPcm` in `lib/cartesia.ts` and it should be
copied verbatim in spirit.

The cost of small chunks is prosody continuity, and the API has the answer: `previous_text` and
`next_text` carry the neighbouring chunks as context that is spoken but not emitted. Confirm
whether those characters are billed before relying on them — if they are, sending 320 characters
of context around every 320-character chunk triples the bill, and the right move is a larger
`CLOUD_CHUNKS` limit (~1,500 characters) instead.

**Log characters, not dollars.** `Starting ElevenLabs synthesis (12,431 words, 74,200 characters
billed, voice: Charlotte, speed 1x)`. The character count is a fact that never goes stale; a price
in a log line is wrong the first time they change the rate card. Rates go in `docs/tts-licensing.md`.

### Characters to words

The one genuinely new piece of logic, and pure — so it is the one that gets the tests.

```
charactersToWords(alignment, requestText) -> ChunkWord[]
```

- Walk `characters`, accumulating non-whitespace into a word; `startMs` is the first character's
  start, `endMs` the last character's end, both `Math.round(seconds * 1000)`.
- `after` is the literal run of whitespace characters that follows the word — not `" "`.
- **`characters.join("")` must equal the request text.** If it does not, normalization crept in
  somewhere and every word after that point is misplaced. Return `[]` and let the chunk fall back
  to no timings, rather than placing words wrongly. This is the same rule Kokoro's
  `write_chunk_words` follows and the reason the Frankenstein em-dash bug was findable.

### Everything else is the Cartesia shape

`lib/elevenlabs.ts` is `lib/cartesia.ts` with a different endpoint: the same disk-cached chunk
WAVs, the same `PAUSE_MS` silence between chunks, the same "a chunk that returns no audio is a
failure, not silence", the same `ElevenLabsAbortedError` mapped to `TtsAbortedError` at the
dispatcher. If a third cloud engine ever lands, *that* is when the common half gets extracted —
not now, with two.

One thing Cartesia does not have and this should: **`GET /v1/user/subscription`** returns
`character_count` and `character_limit`. The picker already has a slot for "set CARTESIA_API_KEY in
.env to list it here"; the same slot can say *"ElevenLabs — 47,300 of 121,000 characters left this
month"*, which is the number that decides whether you press the button.

## What changes

### Server

- `env.ts`, `.env.example` — `ELEVENLABS_API_KEY` (optional, like `CARTESIA_API_KEY`).
- `lib/elevenlabs.ts` — `listElevenLabsVoices` (cached 10 min, stale-while-revalidate),
  `findElevenLabsVoice`, `elevenLabsQuota`, `charactersToWords`, `elevenlabsSynthesize`,
  `ElevenLabsAbortedError`.
- `routes/elevenlabs-voices.ts` — `list` and `quota`, mirroring `routes/cartesia-voices.ts`.
- `router.ts` — mount as `elevenlabsVoices`.
- `lib/tts.ts` — `"elevenlabs"` in `ParsedTtsVoice["engine"]`; a `parseTtsVoice` branch with
  `ELEVENLABS_VOICE_PATTERN = /^[A-Za-z0-9]{16,}$/`; the dispatch branch; `voiceSupportsSpeed`
  returns **true** (`voice_settings.speed`, clamped to the documented 0.7–1.2 the way Cartesia is
  clamped to 0.6–1.5); a `getPreviewTextForVoice` branch off the voice's language.

### Web

- `lib/voices.ts` — `"elevenlabs"` in `VoiceEngine`; an `ENGINE_PREFIXES` row with
  **`supportsSpeed: true`**; `providerOfVoice` → `"ElevenLabs"`; a place in `PROVIDER_ORDER`;
  `elevenlabsVoiceToEntry`; a `getVoiceLabel` fallback for ids with no static entry.
- `VoicePicker.tsx` and `voice-picker/VoiceLibraryModal.tsx` — one more `useQuery` and one more
  branch each, exactly where Cartesia's are, plus the remaining-characters line.

### Docs and tests

- `docs/tts-licensing.md` — ElevenLabs' commercial terms and the rate table above.
- `AGENTS.md` — the engine list.
- `lib/elevenlabs.test.ts` — `charactersToWords` is where the value is: a plain sentence, a word
  followed by a newline rather than a space, punctuation attached to the word before it, and a
  mismatched `characters.join("")` returning `[]`. Plus voice pagination against a mocked `fetch`,
  as in `cartesia.test.ts`.
- `lib/tts-elevenlabs-dispatch.test.ts` — the mirror of `tts-cartesia-dispatch.test.ts`: the
  prefix routes to the client, and the aborted error maps to `TtsAbortedError`.

## Open questions

- **Are `previous_text` / `next_text` characters billed?** Decides the chunk size (see above).
- **Does `with-timestamps` accept `eleven_v3`?** If not, v3 voices must be hidden rather than
  offered, or a chapter silently loses word-level highlighting.
- **Which model is the default?** `eleven_multilingual_v2` for quality, `eleven_flash_v2_5` at
  half the price. Cartesia hardcodes one `MODEL_ID`; the same is probably right here until there is
  a reason for a picker.
- **Bulgarian.** The whole Bulgarian narrator saga exists because nothing good reads it.
  `eleven_multilingual_v2` claims Bulgarian; whether it reads it like a native is an A/B against
  BG-MLX, MMS and KugelAudio, in the same shape as the Piper comparison in `tasks/piper-voices.md`.

## Status

**Shipped 2026-08-25, free tier only, unverified against the live API** — everything below is built
and typechecks, but nothing has run against a real key yet. `scripts/elevenlabs-check.mjs` is the
one command that settles it.

Built as described, with three decisions the research did not anticipate:

- **`ELEVENLABS_MODEL`** exists after all. On a 10,000-credit free month the 1-vs-0.5 credits per
  character between Multilingual v2 and Flash v2.5 is the difference between ten minutes of audio
  and twenty, which is too large to hardcode.
- **The preflight refuses rather than warns.** A free month is roughly one chapter. Finding out at
  chunk 14 of 30 that the credits ran out leaves a half-narrated chapter and an empty balance;
  `checkQuota` counts the characters not already cached on disk, asks
  `GET /v1/user/subscription` once, and throws before the first billed request if they will not fit.
  It stays silent when the quota call itself fails — a monitoring endpoint should not block work.
- **Previews are one sentence, not the paragraph.** `/preview/:voiceId` synthesizes on click, so
  auditioning voices spends the same credits the book needs. `firstSentence` cuts the ~176-character
  preview to ~44 for this engine only. Previews are still cached per voice, so a second listen is free.

`previous_text` / `next_text` are **not** sent — until it is known whether those characters are
billed, tripling a free month's spend for smoother chunk joins is not a trade worth guessing at.

Still open: the v3 question, the Bulgarian A/B, and whether the free tier really serves `pcm_24000`
(the docs restrict only the 44.1 kHz PCM and WAV formats to Pro, and the check script proves it).
