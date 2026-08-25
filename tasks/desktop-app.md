# Task: one draggable app

## Goal

Someone who is not us should be able to download one file, drag it to Applications, open it, and
have a working pdf2audio. Today they need Homebrew, Node 20, pnpm, Python 3.12, Docker, and the
patience to run a script that downloads fifteen gigabytes of models.

## What is actually in the way

Measured on this machine, 2026-08-25.

| Piece | Size | Why it is hard |
| --- | --- | --- |
| Models, in two separate caches | **~14.9 GB** | Too big to ship; must be fetched, and today all of it is fetched eagerly |
| `.venv` (marker, torch, MLX, Kokoro) | 1.8 GB | Thousands of `.so`/`.dylib` files |
| `.venv-pocket` (numpy 2 + torch, separate on purpose) | 856 MB | Second interpreter, deliberately incompatible with the first |
| `node_modules` | 489 MB | A handful of native `.node` binaries |
| Postgres | Docker image | Needs **pgvector** and **pg_trgm**; 7 worker pools open ~25 connections |
| Homebrew CLI: ffmpeg, poppler, espeak-ng | 111 MB | Three separate formula trees, dylib-linked |
| Chromium for Vivliostyle PDF export | ~150 MB | Fetched by puppeteer on demand |

LM Studio gets away with one draggable app because it ships **one Electron shell plus two inference
binaries** and downloads models on demand. We are shipping a database, two Python interpreters, a
Node server and three command-line tools. It is a bigger problem than it looks, and also a more
tractable one than it looks — for one reason.

## The lever: nothing heavy has to be inside the bundle

The thing that makes this feel impossible is code signing. Notarisation requires the hardened
runtime, and **every binary inside a signed `.app` must itself be signed** — one unsigned `.so` in
a 1.8 GB venv fails the whole thing with a cryptic log.

But two facts undo that:

1. **Gatekeeper quarantines what a *browser* downloads, not what an *app* downloads.** Files your
   own process fetches over HTTP never get the `com.apple.quarantine` attribute, so they run
   without being notarised. This is exactly how LM Studio ships runtimes after install.
2. **Everything heavy here already runs as a child process, not as a loaded library.**
   `lib/tts.ts` spawns `python`, `lib/ffmpeg.ts` spawns `ffmpeg`, Postgres would be spawned too.
   Library validation constrains what our *process* may `dlopen`; it says nothing about a separate
   process we exec. No `disable-library-validation` entitlement needed.

So the shape is: **a small signed shell, and a runtime directory it populates on first launch.**

```
pdf2audio.app                          signed, notarised, ~120 MB
  Node runtime + the built server + the web bundle
  a launcher that starts Postgres, starts the server, opens a window

~/Library/Application Support/pdf2audio/     never signed, never quarantined
  postgres/     binaries + data directory
  python/       the two environments
  bin/          ffmpeg, pdftotext, espeak-ng
  models/       fetched per feature, on demand
```

## The four problems

### 1. Postgres — solved, with a caveat

**PGlite is out.** It is a lovely WASM Postgres with pgvector built in, and it is
**single-connection**. `workers/setup.ts` runs seven pools, each with its own connection pool,
alongside the API's `postgres.js` pool and `quickAddJob`'s ad-hoc connections. That is ~25
concurrent connections. Not a tuning problem — an architectural one.

So: **real Postgres binaries, spawned as a child process.** Two routes:

- [`@boomship/postgres-vector-embedded`](https://github.com/boomship/postgres-vector-embedded) —
  PostgreSQL 17.5 + pgvector 0.8.0, prebuilt for macOS arm64, MIT, `new PostgresServer({dataDir,
  port}).start()`. Exactly the shape we want. **Caveat: 49 commits and no release history to speak
  of.** Verify it ships `pg_trgm` (a contrib module, present in a full build, absent from a minimal
  one) before betting on it — we create both `vector` and `pg_trgm` in the migrations.
- **Zonky's `embedded-postgres-binaries`** (darwin arm64v8) plus pgvector compiled against them.
  More work, no dependency on a one-person package. This is what the Electric/Tauri writeups ended
  up doing, and they described building pgvector as the hardest part of the project.

Either way the data directory moves out of a Docker volume and into Application Support, and
`pnpm db:migrate` becomes something the launcher runs at startup.

### 2. Python — download it, don't ship it

Shipping 2.7 GB of venv inside the bundle means signing every `.so` in it. Fetching it after
install means signing nothing.

**`uv` is the tool.** A single ~40 MB static binary that can install a specific CPython and resolve
a locked dependency set, far faster than pip. The first run becomes `uv python install 3.12` then
`uv sync` against a lockfile — which also fixes a real fragility: `scripts/requirements.txt` is a
hand-pinned set that deliberately violates `mlx-audio`'s declared constraints and is installed with
`--no-deps`. A `uv.lock` records what actually worked instead of what pip happened to resolve.

PyInstaller and py2app are the alternative and are a bad fit — they fight torch and MLX, and would
put the result back inside the bundle where it needs signing.

### 3. Node and the server — the easy one

Bundle the Node binary (~50 MB) and `pnpm build`'s output. Node's own binary is signed by Node;
our JS is not a binary. The few native `.node` files we ship (`@napi-rs/canvas`) do need signing,
and there are seven of them, not seven thousand.

### 4. The CLI tools — three static binaries

`ffmpeg`, `pdftotext`, `espeak-ng`. Homebrew's builds are dylib-linked into `/opt/homebrew` and
cannot be copied. Options: fetch static builds on first run (ffmpeg has well-known static macOS
arm64 builds; poppler and espeak-ng need building), or vendor them into the bundle and sign three
binaries, which is tolerable. **espeak-ng also needs its data directory**, which Kokoro's G2P
depends on — that is a path to get right, not a size problem.

Chromium for Vivliostyle is already a runtime download by puppeteer; leave it that way and let PDF
export be the one feature that says "fetching a renderer, one moment".

## The finding that matters most

**Setup downloads ~14.9 GB. A working PDF-to-audiobook needs 347 MB of it.**

| Model | Size | Needed for |
| --- | --- | --- |
| Kokoro-82M | 347 MB | the default voice |
| — | 0 | raw extraction: `pdftotext` only, no model at all |
| marker / surya | **5.1 GB** | full extraction and OCR |
| BGE-M3 | **4.3 GB** | library search and chat |
| Pocket TTS (both repos) | **3.5 GB** | the Pocket voices |
| bg-tts-v5-mlx | 957 MB | the Bulgarian narrator |
| nemo nano codec | 401 MB | mlx-audio |
| mms-tts-bul | 277 MB | Bulgarian MMS |
| KugelAudio 4-bit | 4.6 GB | already opt-in, and already lazy |

Two of those numbers are worth saying out loud. **`setup.sh` says marker is "~2 GB"; it is 5.1 GB**,
and it does not live in `~/.cache/huggingface` at all — surya puts it in
`~/Library/Caches/datalab/models` (`text_recognition` 3.0 GB, `layout` 1.6 GB). Nothing that counts
disk usage today looks there. And the three heaviest downloads — marker, BGE-M3, Pocket — are all
features you can use the app for months without touching.

Upload a PDF, get raw text, narrate it with Kokoro — **that is the whole first-run experience, and
it needs one 347 MB download.** Everything else is a feature you might never touch, and the app
already knows how to fetch things lazily: Pocket languages download per language from the picker,
KugelAudio is a prompt in `setup.sh`.

So the first useful step is not packaging at all. It is **making `setup.sh` lazy** — the same
mechanism the DMG will need anyway, testable today, and it turns an hour-long, 15 GB setup into a
three-minute, 350 MB one for everyone including us.

## The shell

- **Tauri** — ~10 MB, uses the system WKWebView, spawns sidecars natively. Right size, and we do
  not need Chromium for our own UI. Cost: Rust in the tree, and the sidecar/permissions model to
  learn.
- **Electron** — ~150 MB, but it is the ecosystem everything is documented against, and
  `electron-builder` handles signing, notarising and DMG creation as one command. LM Studio is
  Electron.
- **Neither** — a `.app` that is a launcher script plus the default browser. Ugliest, cheapest,
  and would genuinely work: start Postgres, start the server, open `http://localhost:3033`.

Recommendation: **Electron**, for `electron-builder` alone. The signing and notarisation path is
the part nobody wants to invent, and the 140 MB difference is noise against a 350 MB first-run
download.

## Order of work

1. **Make model downloads lazy** (no packaging). Split `setup.sh` into "the ~350 MB you need" and
   per-feature fetches with progress, reusing the Pocket-language mechanism. Useful on its own.
2. **Replace Docker Postgres with a spawned binary.** Prove `pg_trgm` and `vector` both load and
   that seven pools connect. This is the single biggest risk and it can be tested without any app
   shell at all — just point `DATABASE_URL` at it.
3. **Replace `setup.sh`'s pip section with `uv` and a lockfile.** Also an improvement in place.
4. **Vendor the three CLI tools**, or fetch them.
5. **Only then** the Electron shell, signing, notarisation, and a DMG.

Steps 1-4 all make the current developer setup better and are independently shippable. Step 5 is
the only one that is purely about distribution — and by the time it starts, it is a window around
something that already runs from a single directory.

Test on a genuinely fresh machine with the **tart VM probe**, which already exists and already
caught real onboarding bugs once (`4d0adfb`).

## Open questions

- Does `@boomship/postgres-vector-embedded` include `pg_trgm`? If not, zonky plus a pgvector build.
- Is BGE-M3 really 4.3 GB of *needed* files, or several formats where one would do? It is the
  single largest required download and worth ten minutes with `allow_patterns`.
- Can the app run entirely from Application Support with no `.env` file, or does the settings UI
  keep writing one? `lib/env-file.ts` writes keys to a repo-relative path today.

## Status

Researched 2026-08-25, nothing built.
