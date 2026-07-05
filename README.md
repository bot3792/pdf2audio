# pdf2audio

Converts PDF books into MP3 audiobooks with chapter markers. Upload a PDF, pick a voice and speed, and get back a single MP3 with embedded ID3v2 chapter metadata.

Built for local use on Apple Silicon Macs.

## How it works

A PDF goes through a four-stage pipeline, each stage running as a background job:

```
PDF Upload → extract → normalize → synthesize → assemble → MP3
```

**extract** parses the PDF with [Marker](https://github.com/VikParuchuri/marker) to get structured text and heading hierarchy. Chapter boundaries are decided by a local LLM ([Qwen2.5-1.5B](https://huggingface.co/mlx-community/Qwen2.5-1.5B-Instruct-4bit) via mlx-lm): it reads the extracted heading list, picks the real chapter starts while ignoring front matter and subsections, and its answers are fuzzy-matched back to document blocks. If the LLM is unavailable or its output doesn't line up with the document, a heading-level heuristic takes over (h1, then h2, then splitting every ~5000 words). Creates a `chapters` row per detected chapter.

**normalize** (runs per chapter, in parallel) cleans up text for TTS input. Strips markdown syntax, reference markers, bare URLs, and rejoins hyphenated line breaks. Kokoro handles numbers and abbreviations natively, so normalization is intentionally minimal.

**synthesize** (runs per chapter, 2 concurrent) calls [Kokoro TTS](https://huggingface.co/hexgrad/Kokoro-82M) via a Python subprocess to generate speech. Outputs WAV at 24kHz, then FFmpeg converts to MP3. When all chapters finish, queues the assemble job.

**assemble** concatenates chapter MP3s with FFmpeg and writes ID3v2 CHAP/CTOC frames using node-id3 so audio players show chapter markers.

Jobs run through [Graphile Worker](https://github.com/graphile/worker) with a concurrency of 2 (tuned for M4 MacBook running two Kokoro synthesis jobs in parallel).

## Project structure

pnpm monorepo with two packages:

```
packages/server/          Fastify + tRPC API + Graphile Worker + Drizzle ORM
  src/
    main.ts               Fastify entrypoint, file upload/download endpoints, tRPC plugin
    schema.ts             Drizzle table definitions (books, chapters)
    db.ts                 Drizzle postgres connection
    router.ts             Root tRPC router
    trpc.ts               tRPC init
    routes/
      books.ts            list, get, upload, retry, cancel, delete
      chapters.ts         get, retry
    workers/
      setup.ts            Graphile Worker runner with task list
      extract.ts          PDF extraction job
      normalize.ts        Text normalization job
      synthesize.ts       TTS synthesis job
      assemble.ts         Audio assembly job
    lib/
      paths.ts            Data directory path helpers
      marker.ts           Marker subprocess wrapper + chapter detection
      kokoro.ts           Kokoro subprocess wrapper
      ffmpeg.ts           WAV→MP3 conversion, MP3 concatenation
      id3-chapters.ts     MP3 chapter marker writing
      normalizer.ts       Text cleanup rules for TTS input

packages/web/             React 19 + Vite + Tailwind CSS v4 + react-router v7
  src/
    main.tsx              React root, tRPC/QueryClient providers, router
    trpc.ts               tRPC React client
    pages/
      Home.tsx            Upload zone + book list table
      BookDetail.tsx      Per-book view: chapters, progress, play/download/retry
    components/
      UploadZone.tsx      Drag-and-drop PDF upload with voice/speed pickers
      BookList.tsx        Books table with auto-refresh polling
      VoicePicker.tsx     Voice selection dropdown grouped by language
      SpeedSlider.tsx     Speed range slider (0.5x–2.0x)
      StatusBadge.tsx     Color-coded status badge
    lib/
      voices.ts           Kokoro voice list (54 voices across 9 languages)

scripts/
  setup.sh                Full setup script (checks deps, installs Python/Node packages)
  synthesize.py           Kokoro TTS Python script (MPS GPU acceleration)
```

## Database

PostgreSQL in Docker. Schema managed by Drizzle ORM.

**books** — id, title, filename, pdfPath, outputPath, status (`pending` | `extracting` | `synthesizing` | `assembling` | `done` | `failed`), voice, speed, error, totalChapters, createdAt, updatedAt

**chapters** — id, bookId (FK, cascade delete), index, title, rawText, cleanText, audioPath, durationMs, status (`pending` | `normalizing` | `synthesizing` | `done` | `failed`), error, createdAt

## File storage

All runtime data lives in `./data/` (gitignored):

```
data/uploads/{bookId}/    Uploaded PDFs
data/tmp/{bookId}/        Marker JSON output, intermediate files
data/output/{bookId}/     Chapter MP3s and final concatenated MP3
```

## API

**tRPC routes** (proxied from `:3033/trpc` to `:3034/trpc`):

| Route            | Description                                      |
| ---------------- | ------------------------------------------------ |
| `books.list`     | All books with chapter completion count          |
| `books.get`      | Single book with all chapters                    |
| `books.retry`    | Re-extract book, optionally with new voice/speed |
| `books.cancel`   | Mark book + chapters as failed                   |
| `books.delete`   | Delete book, chapters, and files from disk       |
| `chapters.get`   | Single chapter detail                            |
| `chapters.retry` | Re-synthesize a single chapter                   |

**HTTP endpoints** on the server (`:3034`):

| Endpoint                        | Description                                        |
| ------------------------------- | -------------------------------------------------- |
| `POST /upload`                  | Multipart file upload (PDF + voice + speed fields) |
| `GET /download/:bookId`         | Serve final MP3                                    |
| `GET /audio/chapter/:chapterId` | Serve individual chapter MP3                       |

## Prerequisites

- Node.js >= 20 and pnpm
- Python 3.10+ with a conda environment (or global pip)
- Docker (for Postgres)
- FFmpeg — `brew install ffmpeg`
- espeak-ng — `brew install espeak-ng`
- Marker — `pip install marker-pdf`
- Kokoro — `pip install kokoro soundfile`
- Bulgarian narrator — `pip install mlx numpy huggingface_hub` and `pip install "nanocodec-mlx @ git+https://github.com/nineninesix-ai/nanocodec-mlx.git"`
- Meta MMS Bulgarian — `pip install transformers torch`

## Setup

```bash
# Clone and install everything
pnpm setup

# Copy env file (defaults work out of the box)
cp .env.example .env

# Start Postgres
pnpm db:up

# Run migrations
pnpm db:migrate

# Start dev servers (server on :3034, web on :3033)
pnpm dev
```

## Development commands

```bash
pnpm dev              # Start server + web in parallel
pnpm dev:server       # Server only (port 3034)
pnpm dev:web          # Web only (port 3033)
pnpm db:up            # Start Postgres in Docker
pnpm db:down          # Stop Postgres
pnpm db:generate      # Generate Drizzle migration from schema changes
pnpm db:migrate       # Apply migrations
pnpm setup            # Full setup (system deps check, Python/Node deps, data dirs)
```

## Notes

- The web frontend polls `books.get` every 2 seconds while processing, stops when done or failed.
- Vite proxies `/trpc`, `/upload`, `/download`, `/audio`, and `/files` to the server on port 3034.
- Cancel marks jobs as failed in DB — Graphile Worker skips them on next poll.
- Retry deletes all chapters and re-extracts from the PDF.
- Docker Postgres is mapped to host port **5433** to avoid conflicts with other Postgres instances on 5432.
- The Kokoro model (`hexgrad/Kokoro-82M`, 82M params, Apache-2.0) auto-downloads on first run.
- The Bulgarian narrator options are `BG-TTS V5 (Radi Totev MLX port)` and `MMS Bulgarian (Meta)`.
- `raditotev/bg-tts-v5-mlx` and `facebook/mms-tts-bul` should both be cached before offline use.
- Bulgarian voice speed is fixed in this phase; the UI disables speed control for those voices.
- `facebook/mms-tts-bul` is licensed `CC-BY-NC-4.0`.
- `PYTORCH_ENABLE_MPS_FALLBACK=1` is set for MPS compatibility.
- Best voices: `af_heart` (A tier), `af_bella` (A- tier), `bf_emma` (B- tier).
