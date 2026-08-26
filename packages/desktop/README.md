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

Measured from an empty directory: **1.4 GB of Python and PyTorch, plus the 347 MB Kokoro voice and
the 644 MB Postgres image, then HTTP 200.** The environment it builds
narrates a sentence.

`uv` is fetched as a verified tarball rather than `curl | sh`. The pipe version failed once with
`curl: (56) Failure writing output to destination`, which tells a user nothing, and it runs an
unverified script as them.

## Building it

```bash
pnpm app        # .app, installed over /Applications, quarantine cleared — ~15 s
pnpm app:dmg    # the same plus a DMG to hand to someone
```

`pnpm app` uses `--dir`, which skips the DMG *and* `app-update.yml` — so a locally-installed build
never finds an update. That is deliberate (nothing to check against), and the updater stays quiet
about it. Use `pnpm app:dmg` when you want the packaged, updatable article.

`--install` exists because rebuilding proves nothing until the build is installed. It is easy to
spend an afternoon reading the behaviour of `/Applications/pdf2audio.app` while editing the one in
`release/`; the giveaway is `WEB_DIR` in the server's environment pointing somewhere you did not
expect. It also clears the quarantine flag, which is what right-click → Open does by hand.

Bun is fetched on demand. ffmpeg and poppler are not — `bundle-tools.py` copies them out of
Homebrew, so building the app needs `brew install ffmpeg poppler` even though running it does not.
Delete `packages/desktop/resources/bin` or `packages/desktop/build/icon.icns` to force those slow
steps to run again; both are generated and neither is tracked.

## Sharing a library with a checkout

The database records **absolute paths** to every PDF and every audio file, so the data directory is
not a preference — it is the other half of the database. Point the app at a different one than
wrote the files and you get a library that lists 578 books and can play none of them: the audio
route resolves the stored path relative to `DATA_DIR`, and a path that escapes it is a 403.

`~/Library/Application Support/pdf2audio/config.json` says where they already are:

```json
{ "dataDir": "/Users/you/repos/pdf2audio/packages/server/data" }
```

`databaseUrl` and `envFile` are accepted there too. A real install needs none of them — the
defaults are `<home>/data` and `<home>/.env` beside everything else the app fetched. They exist so
a developer running both the app and `pnpm dev` against one Docker Postgres has one library rather
than two halves of one:

```json
{
  "dataDir": "/Users/you/repos/pdf2audio/packages/server/data",
  "envFile": "/Users/you/repos/pdf2audio/.env"
}
```

`envFile` is the answer to "why does Cartesia show up under `pnpm dev` and not in the app". API
keys are read from one `.env` file, and the app's is not the checkout's — pointing it at the
checkout means one set of keys instead of two.

## Where the API keys go

Nobody who installs the app has a checkout, a terminal, or a file to edit, so every key is settable
from **⚙️ → Settings**: AI providers under *Cloud providers*, Cartesia and ElevenLabs under *Cloud
voices*. They are written to the `.env` file named at the bottom of that panel, take effect without
a restart, and are never sent back to the browser — only whether one is set, and its last four
characters.

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

## Releasing

Tag it. `.github/workflows/release.yml` builds on a `v*` tag and publishes the DMG to GitHub
Releases, which is also where `electron-updater` looks — so the download page and the update feed
are the same artefact, and there is nothing to keep in step by hand.

Versions are the date: **`v26.8.26`** for 26 August 2026. It reads as "how old is this" rather
than as a promise about compatibility, which is the honest thing for an app nobody builds against.

```
# packages/desktop/package.json  →  "version": "26.8.26"
git tag v26.8.26 && git push --tags
```

The mac target builds a **zip as well as the DMG**. The DMG is what a person downloads; the zip is
what Squirrel.Mac applies an update from, and without it the updater finds a release it cannot
install. Both are published; only the DMG needs to be linked.

Two constraints, both from `electron-updater` comparing with semver:

- **No leading zeros.** `26.08.26` is not valid semver and update checks fail on it. Write `26.8.26`.
  Ordering still works — `26.8.26 < 26.9.1 < 26.10.1` — because the parts compare as numbers.
- **One release per day.** The format cannot express a same-day hotfix: a `-2` suffix is a
  *prerelease* in semver and sorts *below* the release it was meant to follow. If that day comes,
  the escape is `YY.M.N` — month plus a counter, `26.8.0`, `26.8.1` — which keeps the "how old"
  reading and lifts the limit.

**Until there is an Apple certificate the download is quarantined**, and macOS says "pdf2audio is
damaged and can't be opened" — which is a lie, but it is the lie Gatekeeper tells about unsigned
apps that came from a browser. The release notes have to say: right-click the app → Open → Open.
That instruction is the entire reason the $99 Developer account is worth buying; with it the
workflow signs and notarises and nobody ever sees this. Until then, expect to lose people here.

The updater does not depend on signing, but the *installation* of an update does: an unsigned
update is quarantined the same way. So treat everything before the certificate as pre-release.

### Testing an update without publishing one

```bash
# build the version you want to update *from*, and install it
pnpm app:dmg && cp -R packages/desktop/release/mac-arm64/pdf2audio.app /Applications/

# bump the version, build again, serve the new artefacts as a feed
python3 -m http.server 8765   # in a folder holding latest-mac.yml + the new -mac.zip

# point the installed copy at that feed instead of GitHub
cat > /Applications/pdf2audio.app/Contents/Resources/app-update.yml <<'YML'
provider: generic
url: http://localhost:8765/
YML

# run it from the terminal, not Finder, so the updater's log is visible
/Applications/pdf2audio.app/Contents/MacOS/pdf2audio
```

Check, offer, download and hand-off all work this way. **The install step will fail until the app is
signed** — Squirrel.Mac validates the downloaded app's signature and an ad-hoc one does not pass.
`tasks/desktop-updates.md` has the exact error.

## When something goes wrong

`src/crash.cjs` catches what would otherwise be Electron's own dialog — a stack trace and an OK
button, which tells someone who did not write the app nothing and tells us nothing either. Instead
it appends to `crash.log` beside the rest of the app's data and offers **Report this**, which opens
a GitHub issue with the version, the OS, and the last of the stack already filled in; the person
only has to say what they were doing. A blocked setup step is recorded the same way, so "it did not
start" arrives with the reason attached.

## What is not here yet

Signing and notarising — the DMG builds, and Gatekeeper refuses it until right-click → Open. Model
revisions in the runtime manifest (see `tasks/desktop-updates.md`), so a model that changes upstream
is not invisible. And two features that still assume a checkout: PDF/EPUB export
shells out to the Vivliostyle CLI through `node_modules`, and the Hacker News feed spawns a `.mjs`
script with `process.execPath` — both resolve to nothing inside a compiled binary, so they work in
development and fail in the app.
