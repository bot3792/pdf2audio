# Task: updating the parts an app updater does not reach

## The problem

`electron-updater` replaces the app bundle: the shell, our JavaScript, the compiled server. It does
not touch anything the app installed *after* the user opened it, and on this app that is most of
what matters by weight:

| | updated by the app updater | size |
| --- | --- | --- |
| Electron shell, our JS, the server binary | **yes** | ~180 MB |
| Python environment (torch, marker, MLX) | no | ~2.4 GB |
| Model bundles | no | 347 MB – 15 GB |
| Database schema | no | — |
| Bundled CLI tools (ffmpeg, poppler, espeak) | yes, they are in the bundle | ~110 MB |

So a release that pins a new transformers, adds a model, or adds a migration ships an app whose
shell is version N and whose runtime is version N-1. Nothing warns; things break oddly.

**A restart is an acceptable price.** The user said so, and it simplifies everything: the check can
run at launch, before the window loads the app, in the same first-run screen that already exists.

## The shape

One **runtime manifest** shipped inside the app bundle, and one **state file** in Application
Support recording what is actually installed. On launch, compare; if they differ, run the steps
that differ, then continue.

```jsonc
// resources/runtime.json — built into the app, one per release
{
  "runtime": 3,                       // bumped whenever anything below changes
  "python": { "lock": "<sha256 of uv.lock>" },
  "migrations": 34,                   // count in packages/server/drizzle
  "models": { "kokoro": "hexgrad/Kokoro-82M@<rev>" }
}
```

```jsonc
// ~/Library/Application Support/pdf2audio/runtime-state.json
{ "runtime": 2, "python": "<sha256>", "migrations": 33, "models": { … } }
```

The state file is written **only after a step succeeds**, so an interrupted update repeats rather
than being skipped — the same discipline as the chunk cache in the TTS engines.

## The four things that can drift, and what each needs

1. **Python.** `uv.lock` is already the single source of truth, and `uv sync --frozen` is already
   idempotent — it prints exactly which versions moved, which is how the six patch bumps showed up
   when the dev environment was reconciled. So the check is a hash of `uv.lock`, and the fix is a
   command that already exists. Progress can be parsed from uv's own output.
2. **Migrations.** Count the files in `drizzle/`, or read the last `tag` from `meta/_journal.json`.
   The fix is `drizzle-kit migrate`, which the app must run anyway. **This one has to be ordered:**
   the server must not start against a database it is newer than.
3. **Models.** `scripts/models.py --status` already reports what is cached. What it does not report
   is *which revision*, so a model that changes upstream is invisible. Pin revisions in the manifest
   and have the status check compare them; without that, "update the models" can only mean
   "re-download everything", which is 15 GB.
4. **The app itself.** `electron-updater` against GitHub Releases, which is where the release
   workflow already publishes.

## Order of operations at launch

Getting this wrong is worse than not doing it — a half-updated runtime is harder to diagnose than
an out-of-date one.

```
app updater downloads a new version       (background, applies on next launch)
    ↓ next launch
runtime.json vs runtime-state.json
    ↓ differ
Docker up  →  migrations  →  uv sync  →  model revisions  →  start server
                     ^ never start the server before this
```

The first-run screen already renders exactly this list of steps with progress, blocked states and a
"Check again" button. An update is a first run with fewer rows.

## Decisions to make

- **Do model updates block launch?** A new Kokoro revision is 347 MB and probably should. A new
  Marker is 5.1 GB and probably should not — better as a notice on the feature that uses it, which
  is where its download already lives.
- **Rollback.** `electron-updater` can roll the app back; `uv sync` to an older lock works; a
  migration does not. So the honest rule is that the database only goes forwards, and the app must
  refuse to start against a schema newer than itself rather than failing halfway through a query.
- **How to test it.** The same way the model gates became testable: a file that forces a stale
  state, so the update path is reachable without waiting for a real release.

## Status

Written 2026-08-26, nothing built. `electron-updater` is not yet a dependency.
