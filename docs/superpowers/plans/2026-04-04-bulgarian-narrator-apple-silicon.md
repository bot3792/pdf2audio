# Bulgarian Narrator On Apple Silicon Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Add a high-quality Bulgarian narrator option for `pdf2audio`, optimized for local Apple Silicon use, using `raditotev/bg-tts-v5-mlx` as the primary backend.

**Architecture:** Keep the first version deliberately small. Do not introduce a full multi-engine schema yet. Instead, store engine-prefixed voice IDs in the existing `voice` field, add a small TTS dispatcher on the server, and add one Bulgarian MLX narrator voice to the static voice catalog. Put all backend-specific behavior behind a single server-side synthesis interface so we can pivot to `facebook/mms-tts-bul` later if quality or stability disappoints.

**Tech Stack:** Node/Fastify/tRPC, Python subprocesses, MLX, `soundfile`, `nanocodec-mlx`, Vitest, existing FFmpeg/MP3 assembly flow.

---

## Review Decisions

1. Use `voice` IDs like `kokoro:af_heart` and `bg-mlx:narrator` instead of adding a `ttsEngine` DB column in the first pass.
2. Ship exactly one Bulgarian voice first: the `bg-tts-v5-mlx` audiobook narrator.
3. Disable or ignore speed control for the Bulgarian MLX backend in v1 instead of inventing fake speed support.
4. Add a hard quality gate before full rollout: if real chapter samples are not clearly good enough, pivot to `facebook/mms-tts-bul` using the same dispatcher shape.

## File Map

**Create**
- `packages/server/src/lib/tts.ts`
- `packages/server/src/lib/tts-chunks.ts`
- `packages/server/src/lib/tts-chunks.test.ts`
- `packages/server/src/lib/tts.test.ts`
- `packages/server/src/workers/synthesize.test.ts`
- `scripts/synthesize_bg_tts_mlx.py`

**Modify**
- `packages/server/src/workers/synthesize.ts`
- `packages/server/src/lib/kokoro.ts`
- `packages/server/src/main.ts`
- `packages/web/src/lib/voices.ts`
- `packages/web/src/components/UploadZone.tsx`
- `packages/web/src/components/VoicePicker.tsx`
- `packages/web/src/pages/BookDetail.tsx`
- `scripts/setup.sh`
- `README.md`

## Chunk 1: Runtime Spike And Quality Gate

- Build a minimal standalone MLX synthesis script that accepts `--input`, `--output`, and `--voice`.
- Make it emit the same JSON-line progress protocol already used by Kokoro: `chunks`, `progress`, `done`.
- Add setup steps for `mlx`, `soundfile`, and `nanocodec-mlx`, plus a one-time cache/download step for `raditotev/bg-tts-v5-mlx`.
- Run the script manually on realistic Bulgarian prose before calling the integration complete.

## Chunk 2: Server-Side TTS Abstraction

- Add a small dispatcher in `packages/server/src/lib/tts.ts` that routes `kokoro:*` and `bg-mlx:*` voice IDs.
- Add Bulgarian-aware chunking in `packages/server/src/lib/tts-chunks.ts` tuned for the narrator voice.
- Update `packages/server/src/workers/synthesize.ts` to use the new dispatcher instead of calling Kokoro directly.

## Chunk 3: Preview, Voice Catalog, And UI Wiring

- Add the Bulgarian narrator voice to the static voice catalog.
- Update preview generation so it is engine-aware and uses Bulgarian sample text for the narrator.
- Disable speed control for the Bulgarian narrator in the upload UI.

## Chunk 4: Worker Regression Tests And Verification

- Add worker tests to preserve Kokoro behavior and cover the new generic abort path.
- Run the server test suite and `pnpm build`.
- Manually smoke-test extraction, synthesis, and assembly with a short Bulgarian sample if local dependencies are available.
