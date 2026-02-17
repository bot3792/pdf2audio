# pdf2audio — Agent Context

Personal tool that converts PDF books to MP3 audiobooks with chapter markers. Runs locally on Apple Silicon Macs.

## Architecture

pnpm monorepo with two packages:

- `packages/server` — Fastify + tRPC + Graphile Worker + Drizzle ORM (port 3034)
- `packages/web` — React 19 + Vite + Tailwind CSS v4 + react-router v7 (port 3033)

Postgres runs in Docker (`docker-compose.yml` at root), mapped to host port **5433** (not 5432, to avoid conflicts).

## The Pipeline

```
PDF Upload → extract → normalize (per chapter) → synthesize (per chapter) → assemble → MP3 with chapters
```

### Job Flow (Graphile Worker)

1. **extract** (`workers/extract.ts`) — Runs `marker_single` (Python subprocess) on the PDF, outputs structured JSON into a subdirectory. Parses blocks, detects chapters from headings (h1 → h2 → fallback word-count split). Creates chapter rows in DB. Queues normalize jobs.

2. **normalize** (`workers/normalize.ts`, per chapter, parallel) — Strips markdown, reference markers, URLs, rejoins hyphenated line breaks. Saves clean text. Queues synthesize job.

3. **synthesize** (`workers/synthesize.ts`, per chapter, 2 concurrent) — Runs `scripts/synthesize.py` (Kokoro TTS with MPS/Metal GPU acceleration). Produces WAV at 24kHz, then FFmpeg converts to MP3. Cleans up WAV after conversion. When all chapters done, queues assemble.

4. **assemble** (`workers/assemble.ts`) — FFmpeg concatenates chapter MP3s into one (or copies directly for single-chapter books). node-id3 writes ID3v2 CHAP/CTOC frames for chapter markers.

Worker concurrency is 2 — tuned for M4 MacBook running 2 Kokoro synthesis jobs in parallel.

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

Connection string default: `postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio`

### Tables

**books** — id (uuid), title, filename, pdfPath, outputPath, status (`pending` | `extracting` | `synthesizing` | `assembling` | `done` | `failed`), voice, speed, error, totalChapters, createdAt, updatedAt

**chapters** — id (uuid), bookId (FK, cascade delete), index, title, rawText, cleanText, audioPath, durationMs, status (`pending` | `normalizing` | `synthesizing` | `done` | `failed`), error, createdAt

When modifying the schema, change `schema.ts` and run `pnpm db:generate` to produce a migration, then `pnpm db:migrate`. Never write migrations manually.

## File Storage

All data lives in `./data/` (gitignored):

```
data/uploads/{bookId}/    Uploaded PDFs
data/tmp/{bookId}/        Marker output (JSON inside a subdirectory named after the PDF)
data/output/{bookId}/     Chapter MP3s (ch000.mp3, ch001.mp3, ...) and final concatenated MP3
```

Path helpers are in `lib/paths.ts`. The `DATA_DIR` env var defaults to `./data`.

## Server Structure

```
packages/server/src/
  main.ts               Fastify entrypoint: multipart upload, file download, tRPC plugin, static serving
  db.ts                 Drizzle postgres connection
  schema.ts             Drizzle table definitions (source of truth for DB schema)
  trpc.ts               tRPC init (router, publicProcedure, context)
  router.ts             Root tRPC router combining books + chapters
  routes/
    books.ts            list, get, retry, cancel, delete
    chapters.ts         get, retry
  workers/
    setup.ts            Graphile Worker runner, registers all 4 tasks, concurrency=2
    extract.ts          PDF extraction job
    normalize.ts        Text normalization job
    synthesize.ts       TTS synthesis job
    assemble.ts         Audio assembly + chapter marker writing job
  lib/
    paths.ts            Data directory path helpers (uploadsDir, tmpDir, outputDir)
    marker.ts           Marker subprocess wrapper + chapter detection logic
    kokoro.ts           Kokoro TTS subprocess wrapper
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
    BookDetail.tsx      Per-book view: chapters, progress, play/download/retry/cancel/delete
  components/
    UploadZone.tsx      Drag-and-drop PDF upload with voice/speed pickers
    VoicePicker.tsx     Voice selection dropdown grouped by language
    SpeedSlider.tsx     Speed range slider (0.5x–2.0x)
    StatusBadge.tsx     Color-coded status badge
    BookList.tsx        Books table with auto-refresh polling
```

Vite dev server on port 3033 proxies `/trpc`, `/upload`, `/download`, `/audio`, and `/files` to the server on port 3034 (configured in `vite.config.ts`).

## tRPC Routes

- `books.list` — All books with chaptersCompleted count, ordered by createdAt desc
- `books.get` — Single book with all chapters
- `books.retry` — Re-extract book, optionally with new voice/speed
- `books.cancel` — Mark book + chapters as failed
- `books.delete` — Delete book, chapters, and files from disk
- `chapters.get` — Single chapter detail
- `chapters.retry` — Re-synthesize a single chapter

## HTTP Endpoints (non-tRPC)

- `POST /upload` — Multipart file upload (PDF + voice + speed fields). Creates book row and queues extract job.
- `GET /download/:bookId` — Serve final assembled MP3
- `GET /audio/chapter/:chapterId` — Serve individual chapter MP3

## Chapter Detection Logic

Waterfall in `lib/marker.ts` → `detectChaptersFromBlocks()`:

1. Look for SectionHeader blocks and pick the highest heading level present (h1 → h2 → h3)
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

- Model: `hexgrad/Kokoro-82M` (82M params, Apache-2.0), auto-downloads on first run
- Python subprocess: `scripts/synthesize.py` called from `lib/kokoro.ts`
- Uses MPS (Metal Performance Shaders) for Apple Silicon GPU acceleration
- Env vars: `PYTORCH_ENABLE_MPS_FALLBACK=1`, conda env path via `CONDA_ENV_PATH`
- Outputs WAV at 24kHz, FFmpeg converts to MP3
- 54 voices across 9 languages. Best: af_heart (A), af_bella (A-), bf_emma (B-)
- Auto-chunks long text at phoneme boundaries (max 510 tokens per chunk)

## Marker PDF Extraction Details

- CLI: `marker_single` from `marker-pdf` Python package
- Output: JSON tree (Document → Pages → Blocks), written into `{outDir}/{pdfStem}/{pdfStem}.json`
- `section_hierarchy` on each block tracks heading ancestry
- `metadata.table_of_contents` may or may not be present (some PDFs don't produce it)
- Uses Surya OCR for scanned PDFs, pdftext for digital PDFs
- Env var: `TORCH_DEVICE=mps` for Apple Silicon GPU acceleration

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
```

## Gotchas

- Docker Postgres is on port **5433**, not 5432. Another Docker postgres may conflict — check `docker ps`.
- Marker output is nested in a subdirectory. Code in `lib/marker.ts` searches one level deep for the JSON.
- `metadata` field in Marker JSON output is optional — always null-check it.
- Cancel just marks jobs as failed in DB. Graphile Worker skips failed jobs on next poll. It does not kill running Python subprocesses.
- Retry deletes all chapters and re-extracts from the PDF.
- The frontend polls `books.get` every 2 seconds while processing, stops when status is `done` or `failed`.
- Python LSP errors on `scripts/synthesize.py` are expected — numpy/kokoro/soundfile are runtime deps in the conda env, not visible to the editor.
- Graphile Worker uses the same Postgres database. Its internal tables (`graphile_worker.*`) are managed automatically.
