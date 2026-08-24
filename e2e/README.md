# e2e — Playwright suite for the seams

Tests the real seams between web, server, workers, and external processes — the
happy paths promised by `docs/use-cases.md`, per `tasks/e2e-infra.md`.

## Running

Requires the dev server to be running first (`pnpm dev` from the repo root).

Two tiers, split by Playwright's `@slow` tag:

```sh
pnpm e2e:smoke  # smoke tier — fast tests only, run while developing / before committing
pnpm e2e:full   # full tier — everything, including @slow (marker etc.); run before pushing to main
pnpm e2e:ui     # Playwright UI mode (all tests visible; filter by @slow tag in the UI)
```

(Root-level scripts; inside `e2e/` they are `smoke`, `full`, and `ui` — add
`--headed` to any of them to watch a visible browser window.)

- Every test creates a **fresh profile** and deletes it (with its books and folders)
  afterwards — the real library is never touched. Global setup additionally sweeps
  profiles left behind by interrupted runs (e.g. a test stopped from the UI).
- Slow tests declare themselves with `test.describe("...", { tag: "@slow" }, ...)` —
  no env vars; the smoke tier is simply `--grep-invert @slow`.

## Coverage

The specs mirror the promises of the five intro videos (`docs/use-cases.md`, narrated
by "The pdf2audio Playbook" book): core loop up to raw text (smoke) and through marker
extraction / structure re-cut, say-voice synthesis, and M4B assembly (full); Ask AI with
saved notes and note→chapter; scoped chat with verified citations opening the PDF at the
cited page; transform variants; digests; folders; PDF/EPUB export; the external books API;
model pickers and the settings `.env` round-trip; PDF preview, disk usage, and the log dock.

Deliberately not covered: the HN digest (external network + real model), real-model
quality/speed, and synced-EPUB read-along on a device.

## Fixtures

- `fixtures/tiny-book.pdf` — 3-chapter booklet with real headings; regenerate with
  `pnpm fixtures:pdf` (pdfkit).
- `fixtures/fake-llm.mjs` — OpenAI-compatible stub (`/v1/models`, `/v1/chat/completions`
  with SSE) plus LM Studio (`/api/v0/models`) and Ollama (`/api/tags|show|ps`) discovery
  shapes. AI-flow specs register it at runtime by writing an entry to
  `packages/server/data/llm-models.json` (hot-reloaded by the server) and restore the
  file afterwards — no dev-server restart or env needed.

## Writing new specs

- Import everything from `tests/fixtures.ts` — it is the barrel: `test`/`expect`
  (profile isolation), `createApiBook`, `uploadFixtureBook`, `API_URL`, the fake-model
  keys and canned replies. Don't re-inline upload sequences or `/api/books` POSTs.
- Need chapters? `createApiBook()` — instant, no marker. Need the real PDF path
  (raw text, structure, indexing, PDF preview)? `uploadFixtureBook(page)`.
- Any spec touching an AI flow destructures `fakeLlm` to activate the stub. Plain
  prompts stream `FAKE_REPLY`; a tools request runs one scripted `search_library`
  round and answers `FAKE_CITED_REPLY` (cites `[c_1]`). Three models are registered:
  `e2e-fake` (tools), `e2e-fake-notools`, `e2e-fake-tiny` (100-token context, for
  overflow guards).
- Destructive actions confirm via **native `confirm()`** — Playwright dismisses those
  by default; arm `page.once("dialog", d => d.accept())` before the click.
- No `waitForTimeout` — add a `data-testid` in the web component and wait
  deterministically. Never click pixel coordinates; modals' close buttons carry
  `title="Close"`.
- Slow work (marker, real TTS, Vivliostyle, first embedding load) goes under
  `test.describe("...", { tag: "@slow" }, ...)` with an explicit `test.setTimeout`.
- Voice ids are lowercase engine slugs (`say:samantha`); API-created chapters arrive
  suspended but default-selected and synthesize directly.
