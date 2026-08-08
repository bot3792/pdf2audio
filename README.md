# pdf2audio

Turns PDF books into audiobooks — and more. Upload PDFs, pick a voice, and get chapter-marked MP3s, AI digests, translations, PDF/EPUB exports, and read-along synced EPUBs (audio + highlighted text) you can listen to offline on a phone.

Built for local use on Apple Silicon Macs. Fully offline after the initial model downloads (AI features need a DeepSeek API key).

## What it does

- **PDF → audiobook**: chapter detection (deterministic tiers + optional LLM TOC detection), per-chapter TTS synthesis, single MP3 assembly with ID3v2 chapter markers.
- **Raw-first uploads**: every upload gets instant `pdftotext` raw text; the slow Marker extraction (OCR-capable) is opt-in and can run later.
- **Per-chapter control**: edit text, re-synthesize, include/exclude, suspend/queue, AI cleanup of OCR artifacts, manual or LLM-proposed chapter boundaries.
- **Translations**: first-class per-language chapter variants (DeepSeek) with their own TTS audio and assemblies; the original text is always preserved.
- **Ask AI + notes**: whole-book or per-chapter prompts; every answer is auto-saved as a note on the book.
- **Digest books**: select N books → one synthetic book with an AI summary chapter per source, ready to synthesize.
- **Document export**: selected chapters as PDF/EPUB (Vivliostyle), or as a **synced EPUB** — EPUB 3 with Media Overlays: embedded audio plus sentence-level highlighted text, valid per epubcheck.
- **Read-along on iPhone**: a self-hosted [Storyteller](https://storyteller-platform.dev/) companion (see `storyteller/`) auto-imports synced EPUBs; the free Storyteller Reader app downloads them for fully offline listening with live text highlighting.
- **Library organization**: nested folders with drag & drop, cross-folder search, lightweight profiles (workspaces) so different people keep separate libraries.

## How it works

```
Upload → rawExtract (pdftotext, seconds, always)
       → extract (Marker, opt-in, OCR-capable) → normalize → synthesize (TTS) → assemble → MP3
       → translate → synthesizeTranslation → per-language assembly
       → assembleDocument → PDF / EPUB / synced EPUB
```

Jobs run through [Graphile Worker](https://github.com/graphile/worker) in five pools (TTS, raw text, extraction, assembly, AI/translation) with `maxAttempts: 1` — nothing retries silently; the user reviews failures and decides. Chapter text falls back `customText ?? cleanText ?? rawText` at synthesis time.

TTS engines: [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (English + 8 more languages), KugelAudio (24 EU languages incl. Bulgarian, local 4-bit MLX quant), BG-TTS V5 MLX, and Meta MMS Bulgarian — all local, GPU-accelerated via MPS/Metal.

During synthesis the server keeps a per-chunk text↔audio timing map (`chNNN.sync.json`) next to each MP3. That map powers the web UI's read-along player and the synced EPUB export — and once it exists, the intermediate chunk WAVs can be deleted to reclaim disk.

## Project structure

pnpm monorepo: `packages/server` (Fastify + tRPC + Graphile Worker + Drizzle/Postgres, port 3034) and `packages/web` (React 19 + Vite + Tailwind v4 + react-router 7, port 3033). Python TTS/extraction scripts live in `scripts/`; the optional Storyteller companion in `storyteller/`.

**The detailed, maintained map of files, tables, routes, and pipeline internals is in [AGENTS.md](AGENTS.md)** — this README stays intentionally high-level.

## Database

PostgreSQL 17 in Docker (host port **5433**), schema via Drizzle ORM: `profiles`, `folders`, `books`, `book_files`, `chapters`, `chapter_translations`, `assemblies`, `documents`, `notes`, `book_logs`. See AGENTS.md for column-level docs. Migrations: `pnpm db:generate` + `pnpm db:migrate`.

## File storage

All runtime data lives in `./data/` (gitignored, resolved relative to `packages/server`):

```
data/uploads/{bookId}/            Uploaded PDFs
data/tmp/{bookId}/                Marker JSON output
data/output/{bookId}/             Chapter MP3s + sync maps, assemblies, exported documents
data/output/{bookId}/{lang}/      Translation audio
data/output/{bookId}/chunks/      Chunk WAV previews (disposable once sync maps exist)
data/previews/                    Voice preview MP3s
```

## Prerequisites

- Node.js >= 20 and pnpm
- Python 3.10+ with a conda environment (or global pip)
- Docker (for Postgres and optionally Storyteller)
- FFmpeg — `brew install ffmpeg`
- poppler (`pdftotext`) — `brew install poppler`
- espeak-ng — `brew install espeak-ng`
- Marker — `pip install marker-pdf==1.8.5`
- Kokoro — `pip install kokoro soundfile`
- Bulgarian narrator — `pip install mlx numpy huggingface_hub` and `pip install "nanocodec-mlx @ git+https://github.com/nineninesix-ai/nanocodec-mlx.git"`
- Meta MMS Bulgarian — `pip install transformers torch`
- KugelAudio narrator — `pip install mlx-audio`, then `pip install "transformers==4.57.6" "regex<2025.0.0"` (mlx-audio pulls transformers 5.x, which breaks marker-pdf)
- Optional: a [DeepSeek](https://platform.deepseek.com/) API key for translation, cleanup, digests, Ask AI, and LLM chapter detection

## Setup

```bash
# Clone and install everything
pnpm setup

# Copy env file (defaults work out of the box; add DEEPSEEK_API_KEY for AI features)
cp .env.example .env

# Start Postgres
pnpm db:up

# Run migrations
pnpm db:migrate

# Start dev servers (server on :3034, web on :3033)
pnpm dev
```

### Optional: Storyteller companion (read-along on a phone)

```bash
cd storyteller
openssl rand -base64 32 > STORYTELLER_SECRET_KEY.txt
docker compose up -d          # web UI + API on http://localhost:8001
```

Create the admin account at `http://localhost:8001`, then set `READALOUD_DROP_DIR=<repo>/storyteller/data/import` in `.env` — the "Copy to Storyteller import folder" checkbox on synced-EPUB exports will drop files there and Storyteller auto-imports them. Install the free **Storyteller Reader** iOS/Android app and point it at your Mac's LAN address on port 8001.

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
pnpm jobs             # Show Graphile Worker queue status
pnpm jobs:clear       # Delete all queued jobs
cd packages/server && pnpm test   # Server test suite (spins up template DB, runs migrations)
```

## Notes

- Docker Postgres is mapped to host port **5433** to avoid conflicts with other Postgres instances on 5432.
- The Kokoro model (`hexgrad/Kokoro-82M`, 82M params, Apache-2.0) auto-downloads on first run; `HF_HUB_OFFLINE=1` is set afterwards, so models must be cached before offline use.
- The Bulgarian-capable narrators are `BG-TTS V5 (Radi Totev MLX port)`, `MMS Bulgarian (Meta)`, and `KugelAudio (7B, 24 EU languages)`; Bulgarian voice speed is fixed (UI disables the slider).
- KugelAudio (`kugelaudio/kugelaudio-0-open`, Apache-2.0) runs from a local 4-bit MLX quantization (~5 GB) at `~/.cache/pdf2audio-models/kugelaudio-0-open-4bit` (override with `KUGEL_TTS_MODEL_PATH`); `pnpm setup` downloads and converts it. ~1.5x realtime on an M4 Pro.
- `facebook/mms-tts-bul` is licensed `CC-BY-NC-4.0`.
- Best Kokoro voices: `af_heart` (A tier), `af_bella` (A- tier), `bf_emma` (B- tier).
- Synced EPUBs deliberately end with a non-narrated colophon page — it works around a crash in the Storyteller iOS app when the last spine item carries a media overlay (reported upstream).
