# pdf2audio — Agent Context

Personal tool that converts PDF books to MP3 audiobooks with chapter markers. Runs locally on Apple Silicon Macs. Fully offline after initial model download.

## Product Vision

This is a personal power-user tool, not a polished consumer product. The design priorities are:

**Assembly is a first-class repeatable action, not a terminal state.** The user can assemble an MP3 from selected chapters at any time — mid-synthesis, after tweaking voices, after editing text, after excluding garbage chapters. "Done" just means "there's an assembled MP3 file," not "nothing more can be done."

**Per-chapter control is central.** Each chapter can be independently:
- Synthesized with a different voice or speed
- Edited (custom text override before synthesis)
- Included or excluded from the final assembly
- Queued or suspended from processing
- Re-synthesized without affecting other chapters

**The user is in control of processing.** No silent retries (maxAttempts=1), no auto-decisions. Jobs fail once and stay failed. The user reviews and decides what to retry. Cancel preserves completed work.

**Offline-first.** All ML models (Kokoro TTS, Marker/Surya) are cached locally. `HF_HUB_OFFLINE=1` is set on all Python subprocesses. The app works without internet after initial model download.

**Visibility into what's happening.** Worker activity logs to both the terminal and the UI. Every subprocess event is captured. The user should never wonder "what is it doing right now?"

### Future Directions

- **Custom text editing** — editable chapter text stored as a separate `customText` column (`customText ?? cleanText ?? rawText` fallback chain)
- **Column filtering** — for multi-column PDFs (e.g., parallel translations), filter blocks by x-coordinate to keep only left or right column
- **Per-chapter voice/speed** — different voices for different chapters (e.g., French voice for French text, English voice for English text)
- **Chapter selection for assembly** — include/exclude checkboxes, assemble only selected chapters

## Architecture

pnpm monorepo with two packages:

- `packages/server` — Fastify + tRPC + Graphile Worker + Drizzle ORM (port 3034)
- `packages/web` — React 19 + Vite + Tailwind CSS v4 + react-router v7 (port 3033)

Postgres runs in Docker (`docker-compose.yml` at root), mapped to host port **5433** (not 5432, to avoid conflicts).

Environment variables are managed via `.env` at the repo root (gitignored), with `.env.example` as template. The server loads env via `dotenv` in `packages/server/src/env.ts`, validated through a Zod schema. All server code imports the typed `env` object — never reads `process.env` directly.

## The Pipeline

```
PDF Upload → extract → normalize (per chapter) → synthesize (per chapter) → assemble → MP3 with chapters
```

### Job Flow (Graphile Worker)

1. **extract** (`workers/extract.ts`) — Runs `marker_single` (Python subprocess) on the PDF, outputs structured JSON into a subdirectory. Parses blocks, detects chapters from headings (h1 → h2 → fallback word-count split). Creates chapter rows in DB. Queues normalize jobs.

2. **normalize** (`workers/normalize.ts`, per chapter, parallel) — Strips markdown, reference markers, URLs, rejoins hyphenated line breaks. Saves clean text. Queues synthesize job.

3. **synthesize** (`workers/synthesize.ts`, per chapter, 4 concurrent) — Runs `scripts/synthesize.py` (Kokoro TTS with MPS/Metal GPU acceleration). Two-step process: G2P + phoneme chunking upfront (for accurate progress), then synthesis loop. Produces WAV at 24kHz, FFmpeg converts to MP3. Skips suspended chapters. Writes chunk progress to DB. When all queued chapters done, queues assemble.

4. **assemble** (`workers/assemble.ts`) — FFmpeg concatenates chapter MP3s into one (or copies directly for single-chapter books). node-id3 writes ID3v2 CHAP/CTOC frames for chapter markers.

Worker concurrency is **4** (fixed). All jobs use `maxAttempts: 1` — no silent retries.

### Book Status

Book status during the synthesis phase is **computed from chapter statuses**, not stored. The `computeBookStatus()` function in `routes/books.ts` derives status:

- `extracting` / `assembling` — from stored `books.status` (book-level operations)
- `synthesizing` — any chapter is `pending` / `normalizing` / `synthesizing`
- `done` — all chapters done AND `outputPath` exists
- `failed` — any chapter failed
- `suspended` — all non-done chapters are suspended

### Chapter Statuses

`pending` | `normalizing` | `synthesizing` | `done` | `failed` | `suspended`

Chapters can be individually queued (creates Graphile job) or suspended (no job, won't be processed). Cancel sets non-done chapters to `suspended`, preserving completed audio.

## Key External Tools

| Tool | Purpose | Called from |
|------|---------|------------|
| **Marker** (`marker_single` CLI, `pip install marker-pdf`) | PDF → structured JSON | `lib/marker.ts` |
| **Kokoro TTS** (`pip install kokoro`) | Text → speech via MPS GPU | `scripts/synthesize.py`, called by `lib/kokoro.ts` |
| **FFmpeg** (system binary) | WAV→MP3, MP3 concatenation | `lib/ffmpeg.ts` |
| **node-id3** (npm) | ID3v2 chapter markers | `lib/id3-chapters.ts` |
| **music-metadata** (npm) | Read MP3 duration | `workers/synthesize.ts` |

## Database

PostgreSQL 17 in Docker. Schema in `packages/server/src/schema.ts`. Migrations in `packages/server/drizzle/`.

Connection string via `DATABASE_URL` env var (required, validated by Zod).

### Tables

**books** — id (uuid), title, filename, pdfPath, outputPath, status (`pending` | `extracting` | `synthesizing` | `assembling` | `done` | `failed`), voice, speed, error, totalChapters, createdAt, updatedAt

**chapters** — id (uuid), bookId (FK, cascade delete), index, title, rawText, cleanText, audioPath, durationMs, progress (text, e.g. "12/48"), status (`pending` | `normalizing` | `synthesizing` | `done` | `failed` | `suspended`), error, createdAt

**bookLogs** — id (uuid), bookId (FK, cascade delete), message (text), createdAt

When modifying the schema, change `schema.ts` and run `pnpm db:generate` to produce a migration, then `pnpm db:migrate`. Never write migrations manually.

## File Storage

All data lives in `./data/` (gitignored):

```
data/uploads/{bookId}/    Uploaded PDFs
data/tmp/{bookId}/        Marker output (JSON inside a subdirectory named after the PDF)
data/output/{bookId}/     Chapter MP3s (ch000.mp3, ch001.mp3, ...) and final concatenated MP3
```

Path helpers are in `lib/paths.ts`. The `DATA_DIR` env var defaults to `./data`.

**Important**: `data/tmp/{bookId}/` contains the raw Marker JSON with full block-level data including bbox coordinates. This should be preserved (not deleted) for potential re-processing with different settings (e.g., column filtering).

## Server Structure

```
packages/server/src/
  env.ts                Zod-validated environment variables (dotenv + schema)
  main.ts               Fastify entrypoint: multipart upload, file download, tRPC plugin, static serving
  db.ts                 Drizzle postgres connection
  schema.ts             Drizzle table definitions (source of truth for DB schema)
  trpc.ts               tRPC init (router, publicProcedure, context)
  router.ts             Root tRPC router combining books + chapters
  routes/
    books.ts            list, get, logs, clearLogs, upload, retry, resume, cancel, delete
    chapters.ts         get, queue, suspend
  workers/
    setup.ts            Graphile Worker runner, task wrappers with console logging, concurrency=4
    extract.ts          PDF extraction job
    normalize.ts        Text normalization job
    synthesize.ts       TTS synthesis job (skips suspended, writes progress)
    assemble.ts         Audio assembly + chapter marker writing job
  lib/
    env.ts              (see env.ts above)
    log.ts              appendLog() — writes to DB + console
    paths.ts            Data directory path helpers (uploadsDir, tmpDir, outputDir)
    marker.ts           Marker subprocess wrapper + chapter detection logic
    kokoro.ts           Kokoro TTS subprocess wrapper with onProgress callback
    ffmpeg.ts           FFmpeg WAV→MP3 and concat helpers
    id3-chapters.ts     MP3 chapter marker writing
    normalizer.ts       Text cleanup rules for TTS input
```

## Frontend Structure

```
packages/web/src/
  main.tsx              React root, tRPC/QueryClient providers, BrowserRouter
  trpc.ts               tRPC React client (imports AppRouter type from server)
  styles.css            Tailwind v4 import
  lib/
    voices.ts           Kokoro voice list (54 voices across 9 languages)
  pages/
    Home.tsx            Upload zone + book list table
    BookDetail.tsx      Per-book view: chapters, progress, logs, modal, queue/suspend controls
  components/
    ChapterModal.tsx    Chapter detail modal: metadata, audio player, text preview (clean/raw/split with scroll sync), action buttons (queue/suspend/re-synthesize)
    UploadZone.tsx      Drag-and-drop PDF upload with voice/speed pickers
    VoicePicker.tsx     Voice selection dropdown grouped by language
    SpeedSlider.tsx     Speed range slider (0.5x-2.0x)
    StatusBadge.tsx     Color-coded status badge (includes suspended/amber, cancelled/grey)
    BookList.tsx        Books table with auto-refresh polling
    PipelineSteps.tsx   Pipeline step indicator with suspended awareness
```

Vite dev server on port 3033 proxies `/trpc`, `/upload`, `/download`, `/audio`, `/files`, and `/preview` to the server on port 3034 (configured in `vite.config.ts`).

## tRPC Routes

- `books.list` — All books with chaptersCompleted count, ordered by createdAt desc
- `books.get` — Single book with all chapters (status is computed from chapters)
- `books.logs` — Fetch log entries for a book (with optional `after` cursor)
- `books.clearLogs` — Delete all log entries for a book
- `books.retry` — Re-extract book, optionally with new voice/speed
- `books.resume` — Requeue failed/stuck chapters, preserve done chapters
- `books.cancel` — Set non-done chapters to suspended (preserves done chapters + audio)
- `books.delete` — Delete book, chapters, and files from disk
- `chapters.get` — Single chapter detail
- `chapters.queue` — Queue a chapter for processing (creates Graphile job)
- `chapters.suspend` — Suspend a chapter (prevents processing)

## HTTP Endpoints (non-tRPC)

- `POST /upload` — Multipart file upload (PDF + voice + speed fields). Creates book row and queues extract job.
- `GET /download/:bookId` — Serve final assembled MP3
- `GET /audio/chapter/:chapterId` — Serve individual chapter MP3

## Chapter Detection Logic

Waterfall in `lib/marker.ts` -> `detectChaptersFromBlocks()`:

1. Look for SectionHeader blocks and pick the highest heading level present (h1 -> h2 -> h3)
2. Split text at those heading boundaries into chapters
3. If no headings found, fallback to splitting every ~5000 words ("Part 1", "Part 2", etc.)
4. If there's substantial text before the first heading (>50 words), it becomes a "Preface" chapter

The TOC metadata from Marker (if present) is checked first — if it has 2+ h1 entries, heading-based detection is used.

Blocks kept: Text, SectionHeader, ListItem, Handwriting.
All others dropped (PageHeader, PageFooter, Footnote, Figure, etc.).

**Important**: Marker nests its output in a subdirectory named after the PDF stem. The code handles this by searching one level deep if the JSON isn't at the top of the output directory.

## Text Normalization (`lib/normalizer.ts`)

Intentionally minimal — Kokoro handles numbers/dates/abbreviations natively. We only:
- Strip markdown syntax (bold, italic, code, links, images, headers)
- Remove reference markers ([1], [23])
- Remove bare URLs
- Rejoin hyphenated line breaks
- Collapse excess whitespace

## Kokoro TTS Details

- Model: `hexgrad/Kokoro-82M` (82M params, Apache-2.0), cached locally
- Python subprocess: `scripts/synthesize.py` called from `lib/kokoro.ts`
- Two-step synthesis: G2P + `en_tokenize` phoneme chunking upfront (exact chunk count), then `KPipeline.infer()` loop per chunk
- Uses MPS (Metal Performance Shaders) for Apple Silicon GPU acceleration
- Env vars: `PYTORCH_ENABLE_MPS_FALLBACK=1`, `HF_HUB_OFFLINE=1`, conda env path via `CONDA_ENV_PATH`
- Outputs WAV at 24kHz, FFmpeg converts to MP3
- 54 voices across 9 languages. Best: af_heart (A), af_bella (A-), bf_emma (B-)
- Emits JSON progress per chunk to stdout: `{"type": "chunks", "total": N}` then `{"type": "progress", "chunk": 1, "totalChunks": N, "audioSeconds": 3.2}`

## Marker PDF Extraction Details

- CLI: `marker_single` from `marker-pdf` Python package
- Output: JSON tree (Document -> Pages -> Blocks), written into `{outDir}/{pdfStem}/{pdfStem}.json`
- Each block has `bbox`/`polygon` coordinates (useful for column filtering), `section_hierarchy` for heading ancestry
- `metadata.table_of_contents` may or may not be present (some PDFs don't produce it)
- Uses Surya OCR for scanned PDFs, pdftext for digital PDFs
- Env vars: `TORCH_DEVICE=mps`, `HF_HUB_OFFLINE=1` for offline Apple Silicon GPU acceleration
- Timeout: 24 hours (user cancels manually if needed)

## Logging

All worker activity is logged to both:
1. **Database** — `bookLogs` table via `appendLog(bookId, message)` in `lib/log.ts`
2. **Server console** — same `appendLog()` also prints `[book xxxxxxxx] message` to stdout

Worker task wrapper in `setup.ts` logs start/complete/fail with timing:
```
[worker] Starting synthesize (book cc693a45, ch a1b2c3d4)
[worker] Completed synthesize (book cc693a45, ch a1b2c3d4) (45.2s)
```

Workers prefix chapter-specific logs with `[Ch N]` to disambiguate parallel synthesis.

The UI has a LogViewer component that polls `books.logs` every second during processing, with a "Clear" button to wipe logs.

## Development Commands

```bash
pnpm dev              # Start server (port 3034) + web (port 3033) in parallel
pnpm dev:server       # Server only
pnpm dev:web          # Web only
pnpm db:up            # Start Postgres in Docker (port 5433)
pnpm db:down          # Stop Postgres
pnpm db:generate      # Generate Drizzle migration from schema changes
pnpm db:migrate       # Apply migrations
pnpm setup            # Full setup (system deps check, Python/Node deps, data dirs)
pnpm jobs             # Show Graphile Worker queue status (pending/running/failed)
pnpm jobs:clear       # Delete all jobs from the Graphile Worker queue
```

## Gotchas

- Docker Postgres is on port **5433**, not 5432. Another Docker postgres may conflict — check `docker ps`.
- Marker output is nested in a subdirectory. Code in `lib/marker.ts` searches one level deep for the JSON.
- `metadata` field in Marker JSON output is optional — always null-check it.
- **Cancel preserves done chapters** — only sets non-done chapters to `suspended`. Does NOT kill running Python subprocesses.
- **`tsx watch` restarts kill Graphile Worker** but orphan Python subprocesses. In-flight jobs get re-queued on restart. Don't edit server files during long synthesis runs, or use Resume after.
- **Graphile Worker jobs use `maxAttempts: 1`** — jobs fail once and stay failed. User retries from the UI. Use `pnpm jobs` to inspect the queue, `pnpm jobs:clear` to nuke stale jobs.
- **Book status is computed** from chapter statuses during synthesis. Only `extracting`, `assembling` come from the stored column. `computeBookStatus()` in `routes/books.ts` derives the rest.
- Python LSP errors on `scripts/synthesize.py` are expected — numpy/kokoro/soundfile are runtime deps in the conda env, not visible to the editor.
- Graphile Worker uses the same Postgres database. Its internal tables (`graphile_worker.*`) are managed automatically.
- **Drizzle text enums are TypeScript-only** — adding new status values (like `suspended`) doesn't require a migration since the DB column is just `text`.
- The frontend polls `books.get` every 2 seconds while processing, stops when status is `done`, `failed`, or `suspended`.
- **`HF_HUB_OFFLINE=1`** is set on all Python subprocesses. Models must be cached locally before first use. If a model is missing, the subprocess will fail (not download).

## Pending Task Files

- `TASK-custom-text.md` — Editable chapter text with `customText` column override
- `TASK-remove-log-throttle.md` — Remove the 10% Marker log throttle, log every progress line
- `TASK-preserve-marker-json.md` — Keep Marker JSON for re-processing + future column filtering
- `TASK-chapter-selection-and-assembly.md` — Include/exclude checkboxes + assembly as first-class action
