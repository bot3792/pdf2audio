# pdf2audio — Agent Context

Personal tool that converts PDF books to MP3 audiobooks with chapter markers.

## Architecture

pnpm monorepo with two packages:

- `packages/server` — Fastify + tRPC + Graphile Worker + Drizzle ORM
- `packages/web` — React 19 + Vite + Tailwind CSS v4 + react-router v7

Postgres runs in Docker (`docker-compose.yml` at root).

## The Pipeline

```
PDF Upload → extract → normalize (per chapter) → synthesize (per chapter) → assemble → MP3 with chapters
```

### Job Flow (Graphile Worker)

1. **extract** — Runs `marker_single` (Python subprocess) on the PDF, outputs structured JSON. Parses blocks, detects chapters from headings (h1 → h2 → fallback word-count split). Creates chapter rows in DB. Queues normalize jobs.

2. **normalize** (per chapter, parallel) — Strips markdown, reference markers, URLs, rejoins hyphenated line breaks. Saves clean text. Queues synthesize job.

3. **synthesize** (per chapter, 2 concurrent) — Runs `scripts/synthesize.py` (Kokoro TTS with MPS/Metal GPU acceleration). Produces WAV, then FFmpeg converts to MP3. When all chapters done, queues assemble.

4. **assemble** — FFmpeg concatenates chapter MP3s into one. node-id3 writes ID3v2 CHAP/CTOC frames for chapter markers.

## Key Tools

| Tool | Purpose | Location |
|------|---------|----------|
| **Marker** (Python, `pip install marker-pdf`) | PDF → structured JSON with block types, section hierarchy | Called in `packages/server/src/lib/marker.ts` |
| **Kokoro TTS** (Python, `pip install kokoro`) | Text → speech, runs on Apple Silicon MPS | `scripts/synthesize.py` |
| **FFmpeg** (system binary) | WAV→MP3 conversion, MP3 concatenation | `packages/server/src/lib/ffmpeg.ts` |
| **node-id3** (npm) | Writes MP3 chapter markers (ID3v2 CHAP/CTOC) | `packages/server/src/lib/id3-chapters.ts` |
| **music-metadata** (npm) | Reads MP3 duration for chapter timestamp calculation | Used in synthesize worker |

## Database

PostgreSQL in Docker. Schema managed by Drizzle ORM.

### Tables

**books** — id, title, filename, pdfPath, outputPath, status (pending/extracting/synthesizing/assembling/done/failed), voice, speed, error, totalChapters, createdAt, updatedAt

**chapters** — id, bookId (FK), index, title, rawText, cleanText, audioPath, durationMs, status (pending/normalizing/synthesizing/done/failed), error, createdAt

Schema in `packages/server/src/schema.ts`. Migrations in `packages/server/drizzle/`.

## File Storage

All data lives in `./data/` (gitignored):
- `data/uploads/{bookId}/` — uploaded PDFs
- `data/tmp/{bookId}/` — Marker JSON output, intermediate files
- `data/output/{bookId}/` — chapter MP3s and final concatenated MP3

## Server Structure

```
packages/server/src/
  main.ts           — Fastify entrypoint, multipart upload endpoint, static file serving, tRPC plugin
  db.ts             — Drizzle postgres connection
  schema.ts         — Drizzle table definitions
  trpc.ts           — tRPC init (router, publicProcedure, context)
  router.ts         — Root tRPC router combining books + chapters
  routes/
    books.ts        — list, get, upload, retry, cancel, delete
    chapters.ts     — get, retry
  workers/
    setup.ts        — Graphile Worker runner with task list
    extract.ts      — PDF extraction job
    normalize.ts    — Text normalization job
    synthesize.ts   — TTS synthesis job
    assemble.ts     — Audio assembly job
  lib/
    paths.ts        — Data directory path helpers
    marker.ts       — Marker subprocess wrapper + chapter detection logic
    kokoro.ts       — Kokoro subprocess wrapper
    ffmpeg.ts       — FFmpeg WAV→MP3 and concat helpers
    id3-chapters.ts — MP3 chapter marker writing
    normalizer.ts   — Text cleanup rules for TTS input
```

## Frontend Structure

```
packages/web/src/
  main.tsx          — React root, tRPC/QueryClient providers, BrowserRouter
  trpc.ts           — tRPC React client (imports AppRouter type from server)
  styles.css        — Tailwind import
  lib/
    voices.ts       — Kokoro voice list (54 voices across 9 languages)
  pages/
    Home.tsx        — Upload zone + book list table
    BookDetail.tsx  — Per-book view: chapters, progress bar, play/download/retry/cancel/delete
  components/
    UploadZone.tsx  — Drag-and-drop PDF upload with voice/speed pickers
    VoicePicker.tsx — Voice selection dropdown grouped by language
    SpeedSlider.tsx — Speed range slider (0.5x–2.0x)
    StatusBadge.tsx — Color-coded status badge (pending/extracting/synthesizing/done/failed)
    BookList.tsx    — Books table with auto-refresh polling
```

## tRPC Routes

- `books.list` — All books with chaptersCompleted count, ordered by createdAt desc
- `books.get` — Single book with all chapters
- `books.upload` — Create book record (PDF file uploaded via /upload multipart endpoint)
- `books.retry` — Re-extract book, optionally with new voice/speed
- `books.cancel` — Mark book + chapters as failed
- `books.delete` — Delete book, chapters, and files from disk
- `chapters.get` — Single chapter detail
- `chapters.retry` — Re-synthesize a single chapter

## HTTP Endpoints (non-tRPC)

- `POST /upload` — Multipart file upload (PDF + voice + speed fields)
- `GET /download/:bookId` — Serve final MP3
- `GET /audio/chapter/:chapterId` — Serve individual chapter MP3

## Chapter Detection Logic

Waterfall in `lib/marker.ts`:
1. If Marker TOC metadata has heading_level=1 entries → use h1 SectionHeader blocks as chapter boundaries
2. Else if any h1 SectionHeaders exist → use those
3. Else if any h2 SectionHeaders exist → use those
4. Else fallback → split every ~5000 words, title as "Part 1", "Part 2", etc.

Blocks kept: Text, SectionHeader, ListItem, Handwriting
Blocks dropped: PageHeader, PageFooter, Footnote, Figure, Picture, Caption, TableOfContents, Equation, Code, Form, Reference, ComplexRegion

## Text Normalization (`lib/normalizer.ts`)

Minimal approach — Kokoro handles numbers/dates/abbreviations well natively. We only:
- Strip markdown syntax (bold, italic, code, links, images, headers)
- Remove reference markers ([1], [23])
- Remove bare URLs
- Rejoin hyphenated line breaks
- Collapse excess whitespace

## Kokoro TTS Details

- Model: `hexgrad/Kokoro-82M` (82M params, Apache-2.0)
- Runs via Python subprocess (`scripts/synthesize.py`)
- Uses MPS (Metal Performance Shaders) for Apple Silicon GPU acceleration
- Env var `PYTORCH_ENABLE_MPS_FALLBACK=1` required for MPS
- Outputs WAV at 24kHz, then FFmpeg converts to MP3
- 54 voices across 9 languages. Best voices: af_heart (A), af_bella (A-), bf_emma (B-)
- Auto-chunks long text at phoneme boundaries (max 510 tokens per chunk)

## Marker PDF Extraction Details

- Tool: `marker_single` CLI from `marker-pdf` Python package
- Output format: JSON with tree structure (Document → Pages → Blocks)
- Block types include: Text, SectionHeader, Table, Footnote, PageHeader, PageFooter, Figure, etc.
- `section_hierarchy` field on each block tracks which headings it falls under
- `metadata.table_of_contents` provides detected TOC entries with heading levels
- Uses Surya OCR for scanned PDFs, pdftext for digital PDFs
- Env var `TORCH_DEVICE=mps` for Apple Silicon GPU acceleration

## Development Commands

```bash
pnpm db:up          # Start Postgres in Docker
pnpm db:down        # Stop Postgres
pnpm db:generate    # Generate Drizzle migration from schema changes
pnpm db:migrate     # Apply migrations
pnpm dev            # Start server (port 3001) + web (port 3000) in parallel
pnpm dev:server     # Server only
pnpm dev:web        # Web only
pnpm setup          # Full setup (Python deps, data dirs, Node deps)
```

## Prerequisites

- Node.js >= 20
- pnpm
- Python 3.10+
- Docker (for Postgres)
- FFmpeg (`brew install ffmpeg`)
- espeak-ng (`brew install espeak-ng`)
- Marker (`pip install marker-pdf`)
- Kokoro (`pip install kokoro soundfile`)

## Important Notes

- Graphile Worker concurrency is set to 2 — safe for M4 MacBook running 2 Kokoro synthesis jobs in parallel
- The `data/` directory is gitignored — all uploads, temp files, and output live there
- The web frontend polls `books.get` every 2 seconds while a book is processing, stops polling when done/failed
- Cancel just marks jobs as failed in DB — Graphile Worker will skip them on next poll
- Retry deletes all chapters and re-extracts from the PDF
- Another Docker postgres may conflict on port 5432 — check `docker ps` if startup fails
- Python LSP errors on `scripts/synthesize.py` are expected — numpy/kokoro/soundfile are runtime deps installed via pip, not available to the editor's Python environment
