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

**UI layout mirrors the pipeline order.** Every page reads top-to-bottom in the order things are needed: source files (input) → chapter structure & text work (translate, cleanup, edit) → output creation (synthesize/assemble audio, export PDF/EPUB) → produced outputs. Controls live inside the stage they affect — extraction options belong with source files, not in a generic actions area at the bottom; output-producing buttons sit with the outputs they create. When adding UI, place it by asking "at which pipeline stage does the user need this?"

### Task Tracking

Ideas and planned features live as individual markdown files in `tasks/`. Each file captures the idea, context, and any design notes.

- To propose a new feature or idea, create a new file in `tasks/` (kebab-case, e.g., `tasks/my-feature.md`).
- **After implementing a feature, check `tasks/` for any related task files and delete them.**
- When starting work on a task, read the corresponding file first — it may contain design decisions or constraints.

## Architecture

pnpm monorepo with two packages:

- `packages/server` — Fastify + tRPC + Graphile Worker + Drizzle ORM (port 3034)
- `packages/web` — React 19 + Vite + Tailwind CSS v4 + react-router v7 (port 3033)

Postgres runs in Docker (`docker-compose.yml` at root), mapped to host port **5433** (not 5432, to avoid conflicts).

Environment variables are managed via `.env` at the repo root (gitignored), with `.env.example` as template. The server loads env via `dotenv` in `packages/server/src/env.ts`, validated through a Zod schema. All server code imports the typed `env` object — never reads `process.env` directly.

## The Pipeline

```
PDF Upload → rawExtract (seconds, always) [→ bookNote (optional AI answer → notes)]
           → extract (opt-in, slow) → normalize (per chapter) → synthesize (per chapter) → assemble → MP3 with chapters
```

Every upload extracts raw text with `pdftotext` in seconds (stored per file in `book_files.raw_text`); the slow Marker extraction is **opt-in** ("Extract chapters now" checkbox, default off) and can be run later via `books.extractChapters` from the book page. Raw-only files carry `book_files.status = "raw"` and are skipped by the extract worker until flipped to `pending`. Whole-book Ask AI (`books.aiPromptRaw`) and the upload-time AI prompt run against the concatenated raw text; every AI answer is auto-saved to the `notes` table.

**Synthetic books** (`books.kind !== "pdf"`, currently `"digest"`): books with no PDF (`pdfPath`/`filename` null, zero `book_files` rows) whose chapters are AI-generated text. A **digest** is created from the home page (select books → Create digest): one `digest` job sequentially summarizes each source book (chapter text preferred, raw text fallback via `lib/book-source-text.ts`), saves each summary as a note on the source book, and inserts one suspended chapter per source with a `chapters.source` back-link (`{kind:"book",bookId,title}` — snapshot; future feed chapters use `{kind:"url"}`). Provenance in `books.origin`, run state in `books.digest_job` (progress "3/10", idempotent resume — already-summarized sources are skipped). Everything downstream (normalize/synthesize/translate/cleanup/assemble/export) works on synthetic chapters unchanged; every PDF-assuming path (extract, redetect, retry, structure, propose, applyChapterBoundaries, append-upload) is guarded on `kind !== "pdf"` — keep it that way when adding features.

### Job Flow (Graphile Worker)

0. **rawExtract** (`workers/raw-extract.ts`, always queued at upload) — `pdftotext` per file with `rawText IS NULL` (idempotent for appends), stores `rawText`/`rawWords`. Soft-fails (log only) on scanned/encrypted PDFs. Chains a **bookNote** job when the upload requested an AI prompt; marks `books.noteJob` failed if no file yielded text.

0b. **bookNote** (`workers/book-note.ts`, translate pool) — Runs the upload-time AI prompt against the whole book's raw text via DeepSeek, saves the answer as a note, tracks state in `books.note_job` jsonb (queued/running/done/failed, 15-min stale guard).

0c. **digest** (`workers/digest.ts`, translate pool) — Builds a digest book's chapters: sequentially summarizes each source book from `origin.sourceBookIds`, one suspended chapter + source-book note per source; state in `books.digest_job`; re-queue resumes (sources with an existing chapter are skipped).

1. **extract** (`workers/extract.ts`) — Runs `marker_single` (Python subprocess) on the PDF, outputs structured JSON into a subdirectory. Flattens ALL blocks (not just kept types) with page numbers, polygon coordinates, and an `included` flag. **Chapter detection**: if enabled, first attempts DeepSeek TOC-guided detection (`lib/toc-detect.ts` — finds the printed TOC, selects chapter-start headings by block index); falls back to the numbered-chapter tier (Chapter N / Глава N sequences, ToC listing pages excluded), then the heading-level heuristic (h1 → h2 → fallback word-count split). Stores per-chapter `sourceBlocks` (jsonb) with full block metadata, plus `pageStart`/`pageEnd`. Creates chapter rows in DB. Queues normalize jobs.

2. **normalize** (`workers/normalize.ts`, per chapter, parallel) — Strips markdown, reference markers, URLs, rejoins hyphenated line breaks. Saves clean text. Queues synthesize job.

3. **synthesize** (`workers/synthesize.ts`, per chapter, 4 concurrent) — Runs `scripts/synthesize.py` (Kokoro TTS with MPS/Metal GPU acceleration). Uses `customText ?? cleanText ?? rawText` fallback chain for input text. Two-step process: G2P + phoneme chunking upfront (for accurate progress), then synthesis loop. Produces WAV at 24kHz, FFmpeg converts to MP3. Skips suspended chapters. Writes chunk progress to DB.

4. **assemble** (`workers/assemble.ts`, user-triggered) — FFmpeg concatenates selected chapter MP3s into one (or copies directly for single-chapter books). node-id3 writes ID3v2 CHAP/CTOC frames for chapter markers. Assembly is an explicit user action, not auto-queued. Each assembly is recorded in the `assemblies` table with metadata (duration, chapter count, summary).

Workers run in five pools (`workers/setup.ts`): `tts` (concurrency 2 — MLX contends for the GPU), `raw` (2 — rawExtract, so raw text never queues behind a 30-minute marker run), `extraction` (1 — extract/normalize/redetect/propose), `assembly` (1 — assemble/assembleDocument, separate so exports never queue behind a long extraction), `translate` (3 — translate/translateTitles/cleanup/bookNote). All jobs use `maxAttempts: 1` — no silent retries. Document exports are deduplicated via graphile `jobKey`, and queued/running exports are surfaced by `books.pendingDocumentExports`.

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
| **Marker** (`marker_single` CLI, `pip install marker-pdf==1.8.5`) | PDF → structured JSON | `lib/marker.ts` |
| **Kokoro TTS** (`pip install kokoro`) | Text → speech via MPS GPU | `scripts/synthesize.py`, called by `lib/kokoro.ts` |
| **KugelAudio** (`kugelaudio/kugelaudio-0-open` via `pip install mlx-audio`, local 4-bit MLX quant at `~/.cache/pdf2audio-models/kugelaudio-0-open-4bit`) | Multilingual TTS narrator (24 EU languages incl. Bulgarian) | `scripts/synthesize_kugel_tts.py`, called by `lib/tts.ts` |
| **FFmpeg** (system binary) | WAV→MP3, MP3 concatenation | `lib/ffmpeg.ts` |
| **node-id3** (npm) | ID3v2 chapter markers | `lib/id3-chapters.ts` |
| **music-metadata** (npm) | Read MP3 duration | `workers/synthesize.ts` |

## Database

PostgreSQL 17 in Docker. Schema in `packages/server/src/schema.ts`. Migrations in `packages/server/drizzle/`.

Connection string via `DATABASE_URL` env var (required, validated by Zod).

### Tables

**books** — id (uuid), title, kind (`pdf` | `digest`, default pdf), filename + pdfPath (nullable — null for synthetic books), outputPath, status (`pending` | `extracting` | `synthesizing` | `assembling` | `done` | `failed`), voice, speed, error, totalChapters, noteJob (jsonb), origin (jsonb `BookOrigin` — digest provenance), digestJob (jsonb `DigestJob`), folderId (FK folders, `set null` on folder delete — book deletion must go through `lib/delete-book.ts` for disk cleanup, so never cascade), profileId (FK profiles, defaults to the fixed default-profile id), createdAt, updatedAt

**folders** — id (uuid), name, parentId (self-FK, cascade — nested folders), profileId (FK profiles), createdAt, updatedAt. Books live in at most one folder (null = home/root). Home shows only root-level folder rows + unfiled books; `/folders/:id` shows a folder's contents. Recursive aggregates (bookCount/active/size) are computed in `books.list`; subtree/ancestor walks via CTE helpers in `lib/folders.ts`. `folders.delete` collects all descendant books first and deletes each via `deleteBook` before removing the folder row. `folders.move` reparents a folder (rejects moves into the folder's own subtree).

**chapters** — id (uuid), bookId (FK, cascade delete), index, title, rawText, cleanText, customText, audioPath, durationMs, progress (text, e.g. "12/48"), status (`pending` | `normalizing` | `synthesizing` | `done` | `failed` | `suspended`), error, selected (boolean, default true), pageStart (integer, 1-based), pageEnd (integer, 1-based), sourceBlocks (jsonb — array of block metadata with type, text, page, included, level?, polygon?), createdAt

**assemblies** — id (uuid), bookId (FK, cascade delete), outputPath, durationMs, chapterCount, chapterSummary, chapterIds (json array), createdAt

**documents** — id (uuid), bookId (FK, cascade delete), language (null = original), format (`pdf` | `epub`), outputPath, chapterCount, chapterSummary, chapterIds (json array), createdAt. Written by the `assembleDocument` worker (Vivliostyle CLI renders selected chapters to PDF/EPUB; first run downloads a rendering browser into the Vivliostyle cache).

**bookLogs** — id (uuid), bookId (FK, cascade delete), message (text), createdAt

**profiles** — id (uuid), name, createdAt. Lightweight workspaces (no auth): folders and books carry a profileId; list/create/move routes are scoped to the caller's profile via the `x-profile-id` request header, resolved in `trpc.ts` `createContext` (missing/invalid header → fixed `DEFAULT_PROFILE_ID`, which migration 0025 seeds as "Default" and backfills all pre-profile data onto). Book-level routes (`books.get`, chapters, translations, notes, file downloads) stay unscoped by design — profiles are an organizational boundary, not a security one. The default profile cannot be deleted; other profiles only when empty.

**notes** — id (uuid), bookId (FK, cascade delete), prompt, model (`flash` | `pro`), result (markdown), scope (jsonb `NoteScope` — chapter id+title snapshot or `book-raw`; no FK to chapters so notes survive chapter re-detection), createdAt. Auto-inserted by `chapters.aiPrompt`, `books.aiPromptRaw`, and the `bookNote` worker via `lib/notes.ts` `saveNote()`.

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
  main.ts               Fastify entrypoint: file download, tRPC plugin, static serving
  upload-routes.ts      POST /upload and /upload/:bookId (multipart) — always queues rawExtract; extract only when fullExtract
  db.ts                 Drizzle postgres connection
  schema.ts             Drizzle table definitions (source of truth for DB schema)
  trpc.ts               tRPC init (router, publicProcedure, context)
  router.ts             Root tRPC router combining books + chapters + bookFiles + translations + notes
  routes/
    books.ts            list, get, logs, clearLogs, upload, retry, processSelected, extractChapters, aiPromptRaw, rawTextStats, assemble, assemblies, deleteAssembly, cancel, delete
    chapters.ts         get, queue, suspend, setSelected, setSelectedBatch, setAllSelected, updateText, resetText, queueCleanup, stopCleanup, cleanupSelected, aiPrompt, textStats
    notes.ts            list (per book, newest first), delete
  workers/
    setup.ts            Graphile Worker runner, task wrappers with console logging, five pools
    raw-extract.ts      pdftotext raw text per file (seconds); chains bookNote when requested
    book-note.ts        Upload-time AI prompt against whole-book raw text → note (state in books.note_job)
    extract.ts          PDF extraction job
    normalize.ts        Text normalization job
    synthesize.ts       TTS synthesis job (skips suspended, writes progress)
    cleanup.ts          DeepSeek OCR-artifact cleanup job (per chapter, writes customText)
    assemble.ts         Audio assembly + chapter marker writing job
  lib/
    env.ts              (see env.ts above)
    log.ts              appendLog() — writes to DB + console
    paths.ts            Data directory path helpers (uploadsDir, tmpDir, outputDir)
    marker.ts           Marker subprocess wrapper + chapter detection logic
    deepseek.ts         Shared DeepSeek chat-completions client (translation + TOC detection)
    toc-detect.ts       DeepSeek TOC-guided chapter detection: find printed TOC in first/last pages, select headings (used at extract time and for proposals)
    pdf-raw-text.ts     Whole-document pdftotext wrapper (null on failure/empty)
    book-raw-text.ts    Concatenate per-file raw texts in index order for whole-book AI calls
    token-estimate.ts   Server-side pessimistic token estimate (mirrors web modal) for context guards
    notes.ts            saveNote() shared by aiPrompt, aiPromptRaw, and the bookNote worker
    cleanup.ts          DeepSeek chunk prompt for OCR-artifact cleanup (reuses splitForTranslation)
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
  styles.css            Tailwind v4 import + semantic CSS custom properties for dark mode
  lib/
    voices.ts           Kokoro voice list (54 voices across 9 languages)
    format.ts           Shared date/duration/log-time formatters
  pages/
    Home.tsx            Upload zone + book list table
    BookDetail.tsx      Per-book orchestration: queries/mutations/derived state, staged sections (1 Input → 2 Work → 3 Output → danger zone), language view persisted in ?lang= query param
  components/
    BookFilesSection.tsx    Stage 1 card: source-file table, add files, re-extract (selected/book/re-detect), book-level extraction settings (Force OCR, LLM chapters — persisted immediately via books.updateSettings)
    AudioOutputsSection.tsx Stage 3 card: synthesize/assemble/cancel actions + assemblies list
    DocumentOutputsSection.tsx Stage 3 card: PDF/EPUB export actions + documents list
    LogDock.tsx         Sticky bottom log bar (last line, pulse while processing, z-60 above modals) + full scrollable log modal
    EditableTitle.tsx   Click-to-rename book title
    ChapterTable.tsx    Chapter table with filter panel (search, status, word count, duration), shift+click range selection, per-chapter checkboxes, sticky audio player, modal trigger
    ChapterModal.tsx    Chapter detail modal: selection checkbox, prev/next navigation (< > + keyboard arrows), audio player, view mode tabs (custom/clean/raw/split/blocks with scroll sync), text editing with save/cancel/reset, action buttons (queue/suspend/re-synthesize)
    UploadZone.tsx      Drag-and-drop PDF upload; settings appear once files are staged; extraction-only by default, voice/speed shown only when auto-synthesize is enabled
    VoicePicker.tsx     Voice selection dropdown grouped by language
    SpeedSlider.tsx     Speed range slider (0.5x-2.0x)
    StatusBadge.tsx     Color-coded status badge (includes suspended/amber, cancelled/grey)
    BookList.tsx        Books overview table (activity pills, languages, outputs, size, last activity) with auto-refresh polling
    ProfileSwitcher.tsx Profile dropdown in the Home header (create/rename/delete); active profile id persisted in localStorage and sent as x-profile-id on every request (lib/profile.ts)
```

### Dark Mode

Implemented via **semantic CSS custom properties** in `styles.css`. Tokens are defined under `:root` (light) and flipped via `@media (prefers-color-scheme: dark)`. All components reference tokens like `bg-(--bg-card)`, `text-(--text-primary)`, `border-(--border)` instead of hardcoded zinc colors. This avoids the need for `dark:` prefix on every utility class.

Key tokens: `--bg-page`, `--bg-card`, `--bg-card-hover`, `--bg-subtle`, `--bg-input`, `--border`, `--border-input`, `--divide`, `--text-primary` through `--text-faint`, plus per-status badge pairs and custom text preview tokens.

Accent colors (blue, red, green, amber, indigo) are **not** tokenized — they're the same in both modes. The log viewer terminal uses a fixed dark background (`bg-zinc-900`) in both modes.

Vite dev server on port 3033 proxies `/trpc`, `/upload`, `/download`, `/audio`, `/files`, and `/preview` to the server on port 3034 (configured in `vite.config.ts`).

## tRPC Routes

- `books.list` — `{ folders, books }` scoped to a folder (`folderId` input, null/omitted = root): direct-child books with activity/failure/size stats + child-folder rows with recursive aggregates
- `books.moveToFolder` — Move books into a folder (or null to unfile)
- `folders.list` / `create` / `rename` / `move` / `path` / `deleteStats` / `delete` — Folder CRUD (scoped to the caller's profile); `move` reparents with subtree-cycle rejection; `delete` is recursive (books via `deleteBook`, subfolders via FK cascade); `deleteStats` preflights the confirm dialog
- `profiles.list` / `create` / `rename` / `delete` — Profile (workspace) CRUD; `list` marks the default profile; `delete` refuses the default profile and non-empty profiles
- `books.get` — Single book with all chapters (status is computed from chapters)
- `books.logs` — Fetch log entries for a book (with optional `after` cursor)
- `books.clearLogs` — Delete all log entries for a book
- `books.retry` — Re-extract book, optionally with new voice/speed
- `books.processSelected` — Queue normalize/synthesize jobs for selected non-done chapters
- `books.assemble` — Assemble selected chapters with audio into a single MP3
- `books.assemblies` — List all assemblies for a book
- `books.deleteAssembly` — Delete a specific assembly and its file
- `books.cancel` — Set non-done chapters to suspended (preserves done chapters + audio)
- `books.delete` — Delete book, chapters, assemblies, and files from disk
- `chapters.get` — Single chapter detail (includes full text fields)
- `chapters.queue` — Queue a chapter for processing (creates Graphile job)
- `chapters.suspend` — Suspend a chapter (prevents processing)
- `chapters.setSelected` — Toggle a single chapter's selected state
- `chapters.setSelectedBatch` — Set selected state for multiple chapters at once
- `chapters.setAllSelected` — Set all chapters in a book to selected/deselected
- `chapters.updateText` — Save custom text override for a chapter
- `chapters.resetText` — Clear custom text, reverting to clean/raw text

## HTTP Endpoints (non-tRPC)

- `POST /upload` — Multipart file upload (PDF + voice + speed fields; `x-profile-id` header assigns the profile). Creates book row and queues extract job.
- `GET /download/:bookId` — Serve final assembled MP3
- `GET /download/assembly/:assemblyId` — Serve a specific assembly MP3
- `GET /download/document/:documentId` — Serve an exported PDF/EPUB document
- `GET /audio/chapter/:chapterId` — Serve individual chapter MP3

## Chapter Detection Logic

Waterfall in `lib/marker.ts` -> `extractPdf()`:

1. **LLM-based detection** (when enabled): DeepSeek TOC-guided selection via `lib/toc-detect.ts` — finds the printed TOC in the first/last pages, then selects chapter-start headings from the heading catalog by block index (selecting ~all candidates is treated as failure). Falls through if the API call fails or returns <2 chapters.

1b. **Numbered-chapter tier**: `pickNumberedChapterIndices()` finds Chapter N / Глава N heading sequences (digits or roman numerals), excludes ToC listing pages (≥3 chapter headings on one page), and keeps the longest increasing run of chapter numbers. Used when it finds ≥3 chapters.

2. **Heading-level heuristic** (fallback via `detectChaptersFromBlocks()`): Picks the highest heading level present (h1 → h2 → h3), splits at those heading boundaries. If no headings found, falls back to splitting every ~5000 words ("Part 1", "Part 2", etc.). If there's substantial text before the first heading (>50 words), it becomes a "Preface" chapter.

Blocks kept: Text, SectionHeader, ListItem, Handwriting.
All others dropped (PageHeader, PageFooter, Footnote, Figure, etc.).

**Important**: Marker nests its output in a subdirectory named after the PDF stem. The code handles this by searching one level deep if the JSON isn't at the top of the output directory.

**Propose (LLM) button** (structure modal) uses a different path: `workers/propose.ts` → `lib/toc-detect.ts` calls the DeepSeek API (per source file): call 1 reads the first/last 15 pages (from marker blocks, so OCR books work) and extracts the printed TOC as JSON; call 2 selects chapter-start headings from a blockIndex-keyed catalog and returns a cleaned title per selection (OCR artifacts fixed, TOC wording preferred), with a corrective retry when far fewer headings than TOC entries were selected. Proposal titles flow through apply: `applyChapterBoundaries` accepts optional per-boundary `title` overrides passed to `sliceChaptersAtIndices`. No `max_tokens` on these calls — deepseek-v4-flash spends budget on reasoning first and a cap can produce an empty response; calls take 1-5 min each (reasoning), timeout 600s.

**Cleanup (AI) button** (chapter modal + "Cleanup selected" toolbar batch): `workers/cleanup.ts` → `lib/cleanup.ts` sends chapter text (`customText ?? cleanText ?? rawText`, chunked via `splitForTranslation`) to DeepSeek with a strict strip-artifacts-never-paraphrase prompt (temperature 0.3, `allowEmpty` — a 100%-garbage chunk legitimately cleans to nothing). Cleaned chunks accumulate in memory and land in `chapters.customText` in ONE final write so an interrupted run never truncates a chapter. Run state lives in the `chapters.cleanup` jsonb (`status/progress/error/runToken/createdAt/updatedAt`); `runToken` fences duplicate runs, `updatedAt` drives the 15-min stale-running guard. Batch skips chapters whose cleanup status is `done` (manual customText alone does NOT count as cleaned); re-force is per-chapter "Re-clean". Startup sweep requeues stranded pending/cleaning chapters.

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
- **510 phoneme limit**: Voice pack tensor has 510 entries (indices 0-509). `en_tokenize` can produce chunks >510 chars. `synthesize.py` splits oversized chunks at space boundaries to stay within limits.
- Uses MPS (Metal Performance Shaders) for Apple Silicon GPU acceleration
- Subprocess timeout: **3 hours** (configurable in `lib/kokoro.ts`)
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
- **Cancel preserves done chapters** — only sets non-done chapters to `suspended`. Synthesis cancel aborts the TTS subprocess via DB-status polling (SIGKILL). Extraction cancel (`books.cancel`, `bookFiles.cancel`) kills the marker subprocess through the in-memory registry in `lib/extract-registry.ts` — the registry is lost on a dev-server restart, but the extract worker's conditional status updates keep an orphaned marker run from overwriting the cancel.
- **`tsx watch` restarts kill Graphile Worker** but orphan Python subprocesses. In-flight jobs get re-queued on restart. Don't edit server files during long synthesis runs.
- **Graphile Worker jobs use `maxAttempts: 1`** — jobs fail once and stay failed. User retries from the UI. Use `pnpm jobs` to inspect the queue, `pnpm jobs:clear` to nuke stale jobs.
- **Book status is computed** from chapter statuses during synthesis. Only `extracting`, `assembling` come from the stored column. `computeBookStatus()` in `routes/books.ts` derives the rest.
- Python LSP errors on `scripts/synthesize.py` are expected — numpy/kokoro/soundfile are runtime deps in the conda env, not visible to the editor.
- Graphile Worker uses the same Postgres database. Its internal tables (`graphile_worker.*`) are managed automatically.
- **Drizzle text enums are TypeScript-only** — adding new status values (like `suspended`) doesn't require a migration since the DB column is just `text`.
- The frontend polls `books.get` every 2 seconds while processing, stops when status is `done`, `failed`, or `suspended`.
- **`HF_HUB_OFFLINE=1`** is set on all Python subprocesses. Models must be cached locally before first use. If a model is missing, the subprocess will fail (not download).

## Pending Task Files

See `tasks/` directory. Current tasks:

- `tasks/chapter-merge-split.md` — Merge short chapters or split overly long ones
- `tasks/column-filtering.md` — Filter multi-column PDFs by x-coordinate
- `tasks/per-chapter-voice-speed.md` — Per-chapter voice and speed overrides
