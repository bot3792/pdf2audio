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

### 1. Postgres — **tested end to end 2026-08-25, it works**

**PGlite is out, and measurement confirms why.** With the real server running, `pg_stat_activity`
shows **21 connections at idle**, 14 of them graphile-worker's. PGlite is single-connection. Not a
tuning problem — an architectural one.

So: **real Postgres binaries, spawned as a child process.** That was run for real against
[`@boomship/postgres-vector-embedded`](https://github.com/boomship/postgres-vector-embedded)
(PostgreSQL 17.5 + pgvector 0.8.0, MIT). It works, after three fixes nobody would guess.

**Use the `lite` variant, never `full`.** The `full` build links
`/opt/homebrew/opt/icu4c@77/lib/libicuuc.77.dylib` — Homebrew's ICU, exactly the prerequisite this
whole exercise exists to remove. It only started on this machine because brew happens to be here;
on a fresh Mac it is dead. `lite` links **nothing outside `/usr/lib` and `/System`**, and is 32 MB.

**Both variants ship non-relocatable binaries**, with the CI runner's absolute paths as their
install names:

```
$ otool -L pg/bin/initdb
  /Users/runner/work/postgres-vector-embedded/.../lib/libpq.5.dylib
```

`DYLD_LIBRARY_PATH` papers over it and **must not be used** — the hardened runtime strips `DYLD_*`.
The fix is a post-download pass of `install_name_tool`: rewrite each dylib's id and every reference
to `@rpath/<name>`, then `-add_rpath @loader_path/../lib`. About twenty lines, run once at install.

**`pg_trgm` is not shipped** — the only extensions present are `plpgsql` and `vector`. But PGXS and
the server headers *are* shipped, so it builds from the PostgreSQL 17.5 contrib source:

```
make install USE_PGXS=1 PG_CONFIG=<dir>/bin/pg_config PG_SYSROOT="$(xcrun --show-sdk-path)"
```

`USE_PGXS=1` because the contrib Makefile assumes an in-tree build, and `PG_SYSROOT` because
`pg_config` reports the CI's Xcode 15.4 SDK, which does not exist here. Everything else about
`pg_config` self-relocates correctly.

With those three done, against a cluster spawned from that directory:

| | |
| --- | --- |
| All 32 drizzle migrations | **applied** |
| `pg_extension` | `pg_trgm 1.6`, `plpgsql 1.0`, `vector 0.8.0` |
| HNSW index on `book_chunks.embedding` | created, and **the planner uses it** (`Index Scan using book_chunks_embedding_idx`) |
| Cosine search over 500 rows | correct — a row is its own nearest neighbour at distance 0 |
| Generated `tsvector` + GIN full-text | 500/500 hits |
| `similarity('Frankenstein','Frankenstien')` | `0.529` |
| The real `src/main.ts` | boots, all **7 worker pools** connect, no errors |

One environmental limit worth remembering: **the Unix socket path is capped at 103 bytes**, and the
first attempt failed on that alone. `~/Library/Application Support/pdf2audio/` is comfortably
inside it, but a long username plus a deep data directory is not — put `unix_socket_directories`
somewhere short, or use TCP on loopback.

**And `pg_trgm` is created but never used.** It appears once, in migration
`0026_violet_marrow.sql`, and nothing in the codebase references a trigram index, `similarity()`,
or the `%` operator. Building it is proven and cheap, so build it — but if that ever becomes a
burden, dropping it is a one-line migration rather than a feature loss.

The data directory moves out of the Docker volume into Application Support, and `initdb` plus
`drizzle-kit migrate` become things the launcher does on first run.

### 2. Python — download it, don't ship it

Shipping 2.7 GB of venv inside the bundle means signing every `.so` in it. Fetching it after
install means signing nothing.

**`uv` is the tool**, and it is the standard now rather than a bet. One static binary that installs
a specific CPython *and* resolves a locked dependency set, far faster than pip. The first run
becomes `uv python install 3.12` then `uv sync` against a lockfile.

It also fixes a real fragility rather than merely being faster. `scripts/requirements.txt` is a
hand-pinned set that **deliberately violates `mlx-audio`'s declared constraints**, which is why
`setup.sh` installs three packages with `--no-deps` on top of it. That arrangement works and
nothing records why. A `uv.lock` pins what actually resolved, and `tool.uv.override-dependencies`
states the violation as intent rather than as a shell-script side effect.

PyInstaller and py2app are the alternative and are a bad fit — they fight torch and MLX, and would
put the result back inside the bundle where it needs signing.

### 3. The runtime — **Bun, tested 2026-08-25**

Bun runs this server unmodified. Booted `src/main.ts` under Bun 1.4 against the embedded Postgres:
all **7 worker pools** connected, `GET /trpc/folders.list` answered `{"result":{"data":[]}}`, no
compatibility errors. Fastify, postgres.js, graphile-worker, drizzle and the AI SDK all just worked.

It is also a much better thing to ship:

| | Node | Bun |
| --- | --- | --- |
| Runtime on disk | **504 MB** (the fnm install here) | **61 MB**, one file |
| Ship as | binary + a `node_modules` tree | `bun build --compile` -> **one 75 MB executable** |
| Build time | — | **210 ms** for 965 modules |

The compiled binary was run from outside the repo, with no `node_modules` anywhere near it, and
served the API with all seven pools up.

**The catch is ours, not Bun's.** Compiling changes `import.meta.dirname` to `/$bunfs/root`, the
virtual filesystem inside the executable:

```
as source:  import.meta.dirname = <repo>/packages/server/src/lib
            -> <repo>/scripts/synthesize.py     correct
compiled:   import.meta.dirname = /$bunfs/root
            -> /scripts/synthesize.py           wrong
```

**Ten places** locate Python scripts and `.env` by walking up from their own source file
(`lib/tts.ts`, `lib/kokoro.ts`, `lib/pocket.ts`, `lib/embeddings.ts`, `lib/page-geometry.ts`,
`env.ts`). They all need to come from one configured base directory instead. That is work the
desktop app requires *regardless of runtime* — the scripts will live in Application Support, not
beside the binary — and Node's own single-executable format has the identical problem.

~~**One genuine risk:** Vivliostyle runs as a Node subprocess and might not run under Bun.~~
**Tested — it does.** The same document built under Node and under Bun produced byte-comparable
PDFs, dotted-leader table of contents and page numbers intact. No need to ship two runtimes.

**Recommendation: adopt Bun, don't compile yet.** Ship the `bun` binary plus a bundled JS file —
the size win is already 8x, and the path work can land on its own schedule.

### 4. The CLI tools — three static binaries

`ffmpeg`, `pdftotext`, `espeak-ng`. Homebrew's builds are dylib-linked into `/opt/homebrew` and
cannot be copied. Options: fetch static builds on first run (ffmpeg has well-known static macOS
arm64 builds; poppler and espeak-ng need building), or vendor them into the bundle and sign three
binaries, which is tolerable. **espeak-ng also needs its data directory**, which Kokoro's G2P
depends on — that is a path to get right, not a size problem.

### Vivliostyle, and whether the desktop app needs it

`@vivliostyle/cli` is a typesetting engine: HTML and CSS in, print-quality PDF out. It is used in
exactly one place — `workers/assemble-document.ts`, behind the Export PDF and Export EPUB buttons.
`renderDocumentHtml` builds one HTML file and Vivliostyle sets it.

**What it buys, from our own `PRINT_CSS`:** page numbers in the footer, mirrored margins on left and
right pages, running headers carrying the chapter title via `string-set`, and a contents page with
**dotted leaders and real page numbers** (`leader(dotted)` + `target-counter`). A browser's
print-to-PDF handles the margins and the page breaks; it implements neither `target-counter` nor
`leader()`, so the same document printed from Chrome gets a table of contents with no page numbers
in it. That gap is the entire reason this dependency exists, and it is a real one.

**What it costs:** a 345 MB rendering browser — already fetched lazily on first export, so it costs
nothing until someone presses the button — plus a native `@napi-rs/canvas` module and a subprocess.

**How much it is used, measured on this library:** 7 PDFs and 1 EPUB, ever, the most recent nine
days ago. Over the same period there are **34 `epub-sync` exports**, and those are
`lib/readaloud-epub.ts` — our own zip writer, which never touches Vivliostyle.

So it solves something genuinely hard for a feature that is genuinely marginal. It is already lazy
and now proven to run under Bun, so there is no reason to remove it from the repo. But it is the
strongest candidate for "not in v1 of the desktop app": cutting it drops 345 MB, a native module
and a subprocess, and the export people actually use keeps working.

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

### What first run asks, decided 2026-08-25

Two tiers, not five. **Reading PDFs and turning them into audio are not optional** — they are the
app. Show them ticked and disabled so it is clear what is about to happen, and download them before
the window opens. That is ~2.4 GB, and it buys the whole point of the product.

Everything else is genuinely optional and **gated at the moment it is asked for**, not guarded
throughout the UI:

| | Gate |
| --- | --- |
| Scanned books / OCR | the full-extraction checkbox at upload |
| Search & chat across the library | pressing the library search button |
| Bulgarian narration | choosing a Bulgarian voice in the picker |

Gating at three doorways rather than sprinkling capability checks through every screen is the
difference between a day of work and a month of it. And the pattern already exists twice: Pocket
TTS downloads a language from inside the voice picker with progress, and `setup.sh` prompts before
KugelAudio's 17 GB. An ungated feature keeps the house rule — **the button stays visible and
disabled with a tooltip**, never hidden — and clicking it offers the download.

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
2. **Replace Docker Postgres with a spawned binary.** ~~The single biggest risk.~~ **Proven** — see
   above. What is left is engineering rather than discovery: a supervisor that runs `initdb` once,
   starts and stops the cluster with the app, picks a free port, and applies migrations.
3. **Replace `setup.sh`'s pip section with `uv` and a lockfile.** Also an improvement in place.
4. **Vendor the three CLI tools**, or fetch them.
5. **Only then** the Electron shell, signing, notarisation, and a DMG.

Steps 1-4 all make the current developer setup better and are independently shippable. Step 5 is
the only one that is purely about distribution — and by the time it starts, it is a window around
something that already runs from a single directory.

Test on a genuinely fresh machine with the **tart VM probe**, which already exists and already
caught real onboarding bugs once (`4d0adfb`).

## Open questions

- Is `@boomship/postgres-vector-embedded` a dependency worth keeping, now that its binaries need
  patching anyway? It is 49 commits by one author and its own README calls the TypeScript "example
  usage only". We would use it for one thing: a URL to a tarball. Vendoring the download and the
  `install_name_tool` pass into our own script is maybe fifty lines and drops the dependency.
- Is BGE-M3 really 4.3 GB of *needed* files, or several formats where one would do? It is the
  single largest required download and worth ten minutes with `allow_patterns`.
- Can the app run entirely from Application Support with no `.env` file, or does the settings UI
  keep writing one? `lib/env-file.ts` writes keys to a repo-relative path today.

## Status

Researched 2026-08-25. Postgres tested end to end and proven; everything else still on paper.
