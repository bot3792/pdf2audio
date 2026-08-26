# The desktop shell

What turns this repo into something someone can drag to Applications. The plan and its reasoning
are in `tasks/desktop-app.md`; this package is the part that exists.

## What is here, and tested

- **`src/docker.ts`** — finding Docker. Not with `which`: a GUI app launched from Finder gets
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so a machine happily running Docker reports none. It probes
  the four real install locations and the four socket locations (Docker Desktop, OrbStack, Colima,
  Rancher) and asks the daemon for a version. Verified against a Finder-like environment on a
  machine where `command -v docker` finds nothing and the probe finds `29.4.0`.
- **`src/launch.ts`** — the first-run sequence: Docker, database, Python, voice, server. Docker is
  the only step that *blocks* rather than fails, because it is the one thing the app cannot install
  for you; everything after it is marked blocked too, so a row of hopeful "pending" steps does not
  imply progress that will never come.

## The first run

No checkout, no terminal. The app stages `scripts/`, `pyproject.toml` and `uv.lock` out of its own
bundle into `~/Library/Application Support/pdf2audio`, downloads a pinned and checksummed `uv`,
builds the Python environment from the lockfile, fetches Kokoro, starts Postgres in Docker and
then the server — which also serves the UI, so there is one port and no Vite.

Measured from an empty directory: **1.4 GB installed, then HTTP 200.** The environment it builds
narrates a sentence.

`uv` is fetched as a verified tarball rather than `curl | sh`. The pipe version failed once with
`curl: (56) Failure writing output to destination`, which tells a user nothing, and it runs an
unverified script as them.

## Sharing a library with a checkout

The database records **absolute paths** to every PDF and every audio file, so the data directory is
not a preference — it is the other half of the database. Point the app at a different one than
wrote the files and you get a library that lists 578 books and can play none of them: the audio
route resolves the stored path relative to `DATA_DIR`, and a path that escapes it is a 403.

`~/Library/Application Support/pdf2audio/config.json` says where they already are:

```json
{ "dataDir": "/Users/you/repos/pdf2audio/packages/server/data" }
```

`databaseUrl` is accepted there too. A real install needs neither — the default is
`<home>/data` beside everything else the app fetched. This exists so a developer running both the
app and `pnpm dev` against one Docker Postgres has one library rather than two halves of one.

## The three CLI tools ship inside

`scripts/bundle-tools.py` copies ffmpeg, pdftotext and pdfinfo out of Homebrew at build time along
with their entire dylib closure — 104 libraries, 85 MB — rewrites every load command to
`@loader_path`, and **re-signs each one ad-hoc**. That last step is not optional: Apple Silicon
refuses to run a binary whose signature does not match what `install_name_tool` left behind, and it
does so by killing it with no message, which looks exactly like a missing library.

Two other traps it walks around. Homebrew references most libraries as `@rpath/foo.dylib`, so a
scanner that skips anything beginning with `@` finds almost no dependencies and produces a folder
missing precisely what matters. And libraries must be copied under the name the *load command*
uses: `libpoppler.149.dylib` is a symlink to `libpoppler.149.0.0.dylib`, and copying the target
while rewriting to the link gives a folder where every file exists and none can be found.

Verified with `PATH=/usr/bin:/bin` — no Homebrew — reading a real PDF.

## What is not here yet
## What is not here yet

Signing and notarising — the DMG builds, and Gatekeeper refuses it until right-click → Open.
Bundling the three CLI tools. And the runtime updater in `tasks/desktop-updates.md`, which is what
keeps the Python environment and the models in step with a new release.
