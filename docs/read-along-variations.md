# Read-along: what happens to every kind of chapter

The reader highlights the sentence being spoken on the book's own page. How much of that a
given chapter gets depends on where its text came from and which engine spoke it. This page
says exactly what each case gets, so nothing has to be discovered by watching a highlight
misbehave. The document format itself is in [read-along.md](read-along.md).

## What a cue is

A **cue** is one highlight unit: a span of text with a start and end time in the chapter's
audio, and the rectangles it occupies on the page. Following along is just "which cue is
playing now", so a cue's size *is* the size of the highlight.

A cue is not the same thing as a TTS chunk. A chunk is however much text was handed to the
engine in one go — often a paragraph. Where the engine reports per-word timings, one chunk is
cut into a cue per sentence and each cue also carries its words. Where it doesn't, the chunk
is the cue, and the highlight is as coarse as the chunk was. Each chapter reports which of
those it got through `granularity`, shown in the reader's toolbar.

## Where the chapter's text came from

| Case | What the reader does |
| --- | --- |
| PDF chapter, normalized text | Highlights on the page: sentence rects, and word rects where the engine timed words |
| **AI Cleanup ran on it** | **Text mode — the page mapping is lost.** Cleanup writes `customText`, which no longer corresponds to the PDF's blocks |
| Manually edited text | Text mode, same reason: any `customText` breaks the correspondence |
| Synthetic chapter (digest, external API, note → chapter) | Text mode, no pages. Cues and highlighting work; there is simply no page to draw on |
| **Translated or rewritten lane** | **Not reachable.** The reader lists `chapters`; a variant's audio and sync map live on `chapter_translations`, which the manifest does not expose |
| Extraction older than `chapters.text_map` | Text mode. `pnpm --filter server backfill:textmap` fixes these in place |
| Audio with no sync map (predates them) | A notice on that chapter; the audio still plays, nothing highlights. Re-synthesizing writes one |

## Which engines can time a word

The highlight can only be as fine as the timings the engine gives back.

| Engine | Chunk it is given | Timings it returns | `granularity` |
| --- | --- | --- | --- |
| Kokoro, English (`a`/`b` voices) | up to 510 phonemes | **per word**, from the model's own duration prediction | `word` |
| Kokoro, espeak languages (es, fr, it, pt, hi, zh) | same | none — `en_tokenize` returns no tokens | `chunk` |
| Kokoro chunk over 510 phonemes | re-split | none for the split pieces — the phonemes no longer line up with the tokens | `sentence` |
| macOS `say` | one sentence | none | `chunk` |
| MMS (Bulgarian) | one sentence | none | `chunk` |
| Pocket TTS | packed to ~285 chars | none | `chunk` |
| KugelAudio | packed to ~285 chars | none | `chunk` |
| Bulgarian MLX narrator | packed to ~285 chars | none — and it emits a fixed ~20–24 s per chunk by design | `chunk` |
| Cartesia | packed to ~285 chars | **per word**, `add_timestamps` on the SSE endpoint | `word` |

`say` and MMS are chunked a sentence at a time, so their cues really are sentences even though
`granularity` reports `chunk` — it is derived from the sync map, which does not record which
engine wrote it.

For reference, other hosted engines: **ElevenLabs** returns *character*-level alignment
(`character_start_times_seconds` / `character_end_times_seconds`) from its
`/with-timestamps` and `/stream/with-timestamps` endpoints — finer than anything used here.
It is not a pdf2audio engine today.

## What the page itself is like

| Case | What the reader does |
| --- | --- |
| Digital PDF | Character-exact rects: a sentence starting mid-line starts exactly there |
| Scanned page with an OCR text layer | The same — the layer is what is read, not the image |
| Scanned page with **no** text layer | The sentence gets its paragraph's box; words get nothing rather than a box covering the paragraph |
| Two-column page | Columns are detected and cropped to; rects follow the reading order |
| Drop cap | Its oversized glyph sits below the row it opens, so a word or two near it can read as out of order — about 0.1% of placements |
| Cue spanning a page break | Rects on both pages; following along scrolls to the first |
| Rotated page (`/Rotate`) | **Untested.** The rotation is recorded but not applied, and the renderer does rotate — rects are likely wrong |
| Book with several PDFs | Pages are numbered across all of them; **untested** |
| Right-to-left script | A wrap must cover half a line's width to count as one, so Arabic and Hebrew are not split character by character. No such book to test against |
| Vertical CJK | Not handled — the geometry assumes horizontal rows |

## Things that hold

Re-synthesizing a chapter with a different voice overwrites its sync map, so timings never go
stale. Playback speed does not affect the highlight, since cue lookup uses the audio's own
clock. Chapters synthesized before the switch to AAC are `.mp3` and work unchanged.
