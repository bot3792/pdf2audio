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
// ~/Library/Application Support/Libratory/runtime-state.json
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

**Built 2026-08-26.** Two halves, deliberately separate:

- `src/updater.cjs` — `electron-updater` against GitHub Releases, checked *after* the window is up
  rather than during boot, `autoDownload = false`. A version check has no business delaying a
  launch, and a background download that then demands a restart is the behaviour everyone
  complains about. Installs on quit; offers a restart when the download lands.
- `src/runtime.cjs` — what the app updater cannot reach. `runtime-state.json` in Application
  Support records the `uv.lock` hash that is actually installed and whether the essential models
  are cached; the boot steps compare, skip what is current, and write state only after a step
  succeeds. Verified all three ways: no state (first run, full install), matching state (launch in
  **1 s**, both steps report "up to date"), and a faked stale hash (re-syncs, then records the real
  one).

Two decisions from the plan resolved by building it:

- **Migrations are not in the manifest.** The server applies its own at boot, which gets the
  ordering right for free — it cannot start against a database it is newer than. Tracking them in
  two places would have been the third copy of a fact.
- **The manifest is derived, not declared.** A hash of the shipped `uv.lock` rather than a
  hand-bumped `"runtime": 3`, because the release that forgets to bump a counter is exactly the
  release that ships a mismatched runtime.

### Tested end to end, 2026-08-26

A local feed (`provider: generic` pointing at a `python3 -m http.server` over the release folder,
with the installed app's `Resources/app-update.yml` rewritten to match) against an installed
26.8.26 and a served 26.8.27:

```
Checking for update                                    ✅
Found version 26.8.27                                  ✅
"A new Libratory is available"  → Download it          ✅
185 MB downloaded, handed to Squirrel.Mac              ✅
install                                                ❌
  Code signature at URL …/Libratory.app/ did not pass validation:
  code has no resources but signature indicates they must be present
```

### Confirmed against the live feed, 2026-08-26

Repeated against the published v26.826.0 with an older build installed, so the whole path ran on
real GitHub rather than a localhost feed. Check, find, offer, download, hand-off: all fine. Install
still refused — but with a **different error**, and the difference is the whole story:

| build | what Squirrel says | what it means |
| --- | --- | --- |
| unsigned (linker-only) | `code has no resources but signature indicates they must be present` | the app is **broken** |
| ad-hoc signed | `code failed to satisfy specified code requirement(s)` | the app is **valid**, wrong identity |

The second is one step from working, and the reason is exact: an ad-hoc signature's designated
requirement *is its cdhash*, a hash of the code —

```
$ codesign -d -r- /Applications/Libratory.app
# designated => cdhash H"75d8c207a5d5703ef15da968fa0a68ae3bfa2d5c"
```

— so no future build can ever satisfy a previous build's requirement, because no two builds hash
the same. A Developer ID signature's requirement is *"signed by team X"* instead, which every
future build satisfies. **That, not notarisation, is why signing fixes updates.**

Verifiable without releasing anything: `codesign --verify -R="$(codesign -d -r- old.app | sed
's/# designated => //')" new.app` returns exactly the string Squirrel reports.

**Everything except the last step works, and the last step needs the Apple certificate.**
Squirrel.Mac validates the signature of the downloaded app before swapping it in, and electron-
builder's ad-hoc signature does not satisfy it — so this is not "unsigned apps cannot update", it
is "only a Developer ID signature can". There is no flag that turns it off.

Two things that fell out of testing it:

- **The mac target needs `zip` as well as `dmg`.** The DMG is what a person downloads; the zip is
  what Squirrel applies an update from. Without it the updater finds a release it cannot install,
  and says nothing useful about why.
- **A failed install now says so.** It used to be one line in a log: the user clicks twice and
  waits for a restart that never comes. The error handler distinguishes a failed *check* (silent —
  they did not ask) from a failed *install* (a dialog explaining that this build is not signed, and
  a button to the downloads page, which does work).

Still open: **model revisions.** `models.py --status` reports what is cached, not which revision,
so a model that changes upstream is invisible and "update the models" can only mean "re-download
15 GB". Pinning revisions in the manifest is the fix, and it is the next thing here.
