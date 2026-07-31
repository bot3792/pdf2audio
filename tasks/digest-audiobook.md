# Task: Digest Audiobook (audiobook from summaries of selected books)

## Goal

Select N books on the home page and create a "digest" — a synthetic book whose chapters are AI summaries of each selected book — then listen to it, translate it, or export it like any other book.

## Why

The raw-extraction + notes work makes per-book summaries cheap and instant (raw text lands seconds after upload; DeepSeek summarizes whole books in minutes). The audiobook pipeline already turns any chapters into a chaptered MP3. Composing them yields "10 books → one listenable digest, each source book an ID3 chapter marker" with almost no new pipeline code. Translation composes too: an English library becomes a Bulgarian digest audiobook with the narrator voice, for free.

## Design sketch

- **Synthetic book**: new `books.kind: "pdf" | "digest"` discriminator; `pdfPath`/`filename` become nullable (or sentinel). A digest is a normal `books` row — normalize/synthesize/assemble/translate/cleanup/export all apply unchanged.
- **UI gating is the main cost**: BookDetail assumes files + marker output (re-extract, structure, PDF preview, redetect, Force OCR...). For digest books these are disabled with tooltips (never hidden, per convention). This is where the bugs would live — do it carefully.
- **Creation flow**: home page reuses the existing multi-select (built for bulk delete) → "Create digest (N)" → modal with title, summary prompt (NEW listening-oriented preset — bullet lists sound terrible in TTS; think "narrate a 5-minute spoken summary"), flash/pro picker, voice, source order → creates digest book → queues one summary job per source book (translate pool, like `bookNote`).
- **Orchestration**: each summary completion inserts a suspended chapter titled after its source book; a `noteJob`-style jsonb on the digest book tracks "6/10 summaries" with the usual 15-min stale guard. Then synthesize/assemble as with any book.
- **Snapshot semantics** (same as notes): later changes to source books do not retroactively update the digest.

## Open questions

1. Reuse an existing note when a source book already has one, or always generate fresh with the digest's prompt? Lean always-fresh — one consistent voice/length across the digest.
2. Store `sourceBookId` per digest chapter (jsonb) for a back-link in the UI? Cheap, probably yes.
3. What happens when a source book has no raw text (scanned, no OCR)? Skip with a visible per-chapter failure, or block creation? Lean skip-with-log, matching the per-file failure philosophy.

## Effort

~1-2 sessions. Half is the `kind` schema change + BookDetail gating, half is the modal + summary worker + tests. Prerequisite wisdom: let the notes/summary flow settle in real use first, so the listening preset reflects what a good summary actually looks like.
