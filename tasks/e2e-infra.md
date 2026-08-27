# Task: E2E test infrastructure — validate the pieces fit together

## Goal

A Playwright-based e2e suite (`e2e/` at the repo root, `pnpm e2e:dev` against a running dev
server) that exercises the real seams between web, server, workers, and external processes —
the places unit tests structurally cannot cover. Unit coverage is strong (379 server tests) but
every recent regression lived *between* the pieces: a tRPC endpoint the web typed differently,
a worker payload that silently narrowed, a model-picker default that broke on a local-only
setup, an LM Studio model type the discovery filter dropped.

## Why now

The LLM-provider arc (2026-08-24) was a case study in cross-piece risk: model keys flow
UI → route zod → jsonb payload → worker → registry → external server, and no single unit test
sees that whole path. Each seam was verified by hand in the session (curl + browser + live
Ollama/LM Studio); the point of this task is to make those hand checks repeatable.

## What to test — the Playbook happy paths

**`docs/use-cases.md` is the source of truth for happy-path coverage.** It distills the five
video tutorials (narrated by "The Libratory Playbook" book in the app) into assertable user
journeys UC1–UC7. Implement them roughly in order — UC1 (core loop) and UC2 (Ask AI) carry the
most user value per test. The infrastructure below exists to make those journeys testable.

## Scope — highest-value flows first

1. **Settings / AI models panel**: gear opens the modal; local servers section renders
   detection state; saving a dummy cloud key writes `.env`, models appear in pickers without
   restart, removing restores `.env` byte-identical (the session's manual round-trip, automated).
2. **Model pickers**: every picker lists the same registry (grouped by source); chat picker
   disables no-tool models; invalid persisted key auto-corrects to first available.
3. **Upload → extract → structure**: drop a small fixture PDF, raw extraction lands, Structure
   modal opens, heuristic Propose returns boundaries, Apply creates chapters.
4. **Ask AI / chat smoke** against a **fake OpenAI-compatible server** (tiny fixture process
   that replays canned completions — no cloud keys, no real local model, deterministic): full
   stream renders, note is saved, context-overflow guard message appears for an oversized scope.
5. **Variant flow**: start a transform against the fake server, streamed text lands in the
   modal, params (model/thinking) persist on the variant row.

## Infrastructure notes

- Follow the house testing rules: no `waitForTimeout` — add `data-testid` + deterministic waits
  (`waitFor({ state: "detached" })`); prefer `pnpm e2e:dev` (fast, running dev server) over a
  Docker compose path, and if Docker is used, tear down with
  `docker compose -f docker-compose.e2e.yml down`.
- The **fake LLM server** is the keystone: an OpenAI-compatible stub (one small Node script,
  `/v1/models` + `/v1/chat/completions` with SSE) registered via `LOCAL_LLM_URL`. It makes every
  AI flow testable offline and deterministic, and doubles as a fixture for discovery tests
  (LM Studio `/api/v0/models` shape, Ollama `/api/tags` + `/api/show` + `/api/ps` shapes —
  including the `vlm` type and the unloaded-context case that both bit us).
- Seed data: one tiny public-domain PDF fixture (a few pages, headings) checked into
  `e2e/fixtures/`; a fresh profile per run so the user's library is never touched.
- DB: point the dev server at a scratch database (`DATABASE_URL` override) or a dedicated
  profile; never run against the real library.

## Non-goals

- Not a real-model benchmark suite (local model speed/quality varies per machine — that stays
  manual, see the Frankenstein session notes).
- Not synthesis/TTS coverage in v1 — audio pipelines are slow and machine-dependent; assert up
  to "chapter queued" only.
