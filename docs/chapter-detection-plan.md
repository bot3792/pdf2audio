# Chapter Detection — Diagnosis & Improvement Plan

_Written 2026-07-24. Branch: `kugel-tts-marker-pages`. Context for a fresh session._

## TL;DR

Deterministic chapter detection mis-sliced the book **Influence** (id `bce1c2f9-d887-4e12-b9d2-9f011e6313a7`): the whole body (p4–433, 168,679 words) collapsed into a single "Preface", and the 9 detected "chapters" are actually the **endnotes** section (p434–471). Root cause is a dedup heuristic that prefers the *last* occurrence of each duplicate chapter number — which is the notes copy, not the body copy. The user wants both a targeted fix **and** a broader rework so they have visibility and control over how a book gets parsed. Four workstreams were agreed. This doc is the spec.

## Root cause (confirmed against cached marker output)

The cached marker JSON for this book contains **18** `Chapter N` headings — each chapter number appears twice:

```
p14  Chapter 1 Levers of Influence      ← real body chapters, spread ~40pp apart
p32  Chapter 2 Reciprocation
p74  Chapter 3 Liking
p119 Chapter 4 Social Proof
p179 Chapter 5 Authority
p214 Chapter 6 Scarcity
p256 Chapter 7 Commitment and Consistency
p316 Chapter 8 Unity
p380 Chapter 9 Instant Influence
────────────────────────────────────────
p434 Chapter 1: Levers of Influence      ← ENDNOTES, organized by chapter, ~3pp apart
p437 Chapter 2: Reciprocation
p441 Chapter 3: Liking
p446 Chapter 4: Social Proof
p451 Chapter 5: Authority
p454 Chapter 6: Scarcity
p457 Chapter 7: Commitment and Consistency
p461 Chapter 8: Unity
p471 Chapter 9: Instant Influence
```

In `packages/server/src/lib/marker.ts`, `pickNumberedChapterIndices()` (around line 221):

1. Collects all 18 matches. Dominant kind = `chapter` (all 18).
2. Per-page filter (`perPage < 3`) keeps all 18 — each heading is on its own page, so nothing is dropped as a ToC listing.
3. **The bug — dedup at lines 242–244:** `lastByNum` keeps the *last* occurrence of each number. The comment says "the body heading comes later" — true for a **table of contents** (listed early, body later), but **false for endnotes/notes** (which come *after* the body). So it keeps all 9 notes headings (p434–471).
4. Longest strictly-increasing run = those 9 notes headings. Body content before p434 becomes the giant "Preface".

The user's guess ("you changed it to use a deeper heading level") is not the mechanism — `pickNumberedChapterIndices` wins over `pickChapterHeadingIndices` whenever ≥3 numbered headings exist (`detectChaptersFromBlocks`, line 262–263). The deeper-heading-level path (`pickChapterHeadingIndices`) never ran for this book.

### Why the LLM path avoids this

`scripts/detect_chapters.py` builds candidate headings but **excludes ToC/notes pages** (`select_candidate_headings` skips `h["page"] in toc_page_set`, and works from the actual table-of-contents text + `pdftotext` ToC extraction). It reasons from the ToC rather than from raw heading order, so the endnotes duplicates don't fool it. So **yes — LLM detection should fix this book.**

### Good news: re-detection is cheap for this book

Cached marker output still exists at:
```
packages/server/data/tmp/bce1c2f9-d887-4e12-b9d2-9f011e6313a7/file_0/.../*.json
```
So re-detection (deterministic or LLM) reuses the extraction — **no OCR re-run, and there is no synthesized audio to lose** (chapters are all `suspended`). The `redetectChapters` mutation already reuses `bookTmpDir`.

## What already exists (don't rebuild)

- **Re-detect + LLM toggle UI**: `packages/web/src/pages/BookDetail.tsx` "Book actions" section (~line 289–347) has a "LLM chapters" checkbox, "Re-detect chapters" and "Re-extract entire book" buttons wired to `redetectMutation` / `retryMutation`.
- **Redetect endpoint**: `books.redetectChapters` mutation in `packages/server/src/routes/books.ts` (line 246+). Currently **synchronous inside the HTTP mutation** — deletes chapters/assemblies/audio, re-runs detection (LLM can take minutes with the 27B model → the request hangs), re-inserts. Takes `{ id, forceOcr?, llmChapterDetection? }`.
- **LLM detector**: `packages/server/src/lib/chapter-detect.ts` → spawns `scripts/detect_chapters.py` (model `mlx-community/Qwen3.6-27B-4bit`, 600s timeout). Returns `{title, page}[]` boundaries; `chaptersFromLlmBoundaries()` in marker.ts fuzzy-matches them to heading blocks.
- **Blocks view**: ChapterModal already has a "blocks" tab showing every `SourceBlock` with page + type + included flag. `sourceBlocks` (with pages) persisted since migration `0007`.
- **API**: server on `:3034`, vite proxy on `:3033`. tRPC over HTTP.

## Agreed workstreams (all four selected)

### 1. Deterministic dedup fix (small, do first)

In `pickNumberedChapterIndices`, replace the `lastByNum` "keep last" dedup with **"keep the occurrence that starts the most body content"**. For each duplicate chapter number, prefer the heading followed by the most included-text words before the next chapter heading (body chapters are long; notes entries are short). This naturally selects p14–380 over p434–471.

- Compute, per match (sorted by block index), the included word count from that heading until the next chapter-heading match index.
- Group by `num`; keep the max-content occurrence per number.
- Keep the existing longest-increasing-run step afterward.
- **Regression test** in `marker.test.ts` (new file already on branch) using this book's real 18-heading layout (two clusters, duplicate numbers) → expect the p14–380 set. Also keep a ToC-straggler case working (early duplicates with little following content should still resolve to the body copy — which the content heuristic handles, since a ToC line has ~0 following body words).
- Watch the interaction with the `perPage < 3` filter and the `Preface` prepend (marker.ts:279–285).

### 2. Structure view + manual boundaries (the real feature)

A book-level "Structure" UI that makes parsing legible and editable **without** a blind destructive re-run:

- Show the **full-book heading outline** (all `SectionHeader` blocks with page, level, text) — reuse `sourceBlocks` already stored per chapter, or add a book-level endpoint that returns the flat heading list from cached marker output.
- Each heading has a **toggle: "is a chapter boundary"**. Toggling re-slices chapters live (client-side preview of resulting chapter list: title, page range, word count).
- **Instant re-slice + commit**: apply the chosen boundaries to produce the actual chapters (server mutation that slices from `sourceBlocks`/marker output by chosen boundary indices — same slicing logic as `detectChaptersFromBlocks`, factored out).
- **PDF page links**: reuse the `PdfPreviewModal` (already added on this branch) so each heading/boundary opens the source PDF at its page — lets the user verify OCR/marker against the source (this ties into the page-mapping work already shipped in commit `f635847`).
- Goal: user can see "here's every heading we found, here's which ones we treated as chapters" and fix it by hand in seconds.

### 3. Detection-as-proposal (not blind destructive re-run)

From the structure view, run LLM **or** deterministic detection as a **proposal**: it returns a candidate boundary set the user reviews/edits before committing. Only on "Apply" does it delete/replace chapters. Removes the "wait minutes, hope it's right, otherwise redo" loop. Reuse the existing detectors but return boundaries instead of mutating.

### 4. Background re-detect job

Move `redetectChapters` (and the proposal runs, since LLM is slow) out of the synchronous HTTP mutation into a **graphile-worker job**, with book status/progress surfaced like extraction (the app already has `extract` worker + status badges + log streaming to model after). The HTTP call should enqueue and return; the UI polls. Prevents the multi-minute hang the user complained about.

## Suggested order

1. **(1) dedup fix + test** — unblocks this book on the deterministic path immediately; low risk.
2. Optionally run LLM re-detect on `bce1c2f9…` to confirm the LLM path also produces the clean 9-chapter set (cached extraction, safe).
3. **(4) background job** — foundation so (2)/(3) don't hang the request.
4. **(3) proposal endpoints** — detectors return boundaries.
5. **(2) structure view UI** — consumes proposals + manual editing + PDF page links.

## Context: current branch state

Branch `kugel-tts-marker-pages` already contains:
- `aaef7f3` — KugelAudio TTS backend + marker page metadata (the pre-existing WIP that was committed at the start of this session).
- `f635847` — **Open PDF preview at the active chunk's source page.** Adds `pageAtOffset()` in `chunk-previews.ts`, `page` field on chunk previews via `chapters.get`, shared `PdfPreviewModal` component, "PDF p.N" button in the chunk player. 78 server tests pass. This is what enables the "jump to source of truth" verification loop that motivates the structure-view PDF links above.

Nothing from this plan (workstreams 1–4) is implemented yet — this doc is the starting point for the next session.
