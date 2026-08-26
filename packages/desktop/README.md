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

Bun and the bundled CLI tools are both fetched on demand and checksummed, so **building the app
needs no Homebrew ffmpeg or poppler** — only `librsvg` and `imagemagick`, and only when the icon
has to be re-rendered. (Running the server *from source* is a different matter: `pnpm dev` spawns
bare `ffmpeg` and `pdftotext` off your `PATH`, so a checkout still wants them installed. The app
does not — it puts its own bundled copies first.)

Delete `packages/desktop/resources/bin` or `packages/desktop/build/icon.icns` to force those steps
to run again; both are generated and neither is tracked.

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

`scripts/bundle-tools.py` copies ffmpeg, pdftotext and pdfinfo out of Homebrew — not during a build
any more, but when the bundle is deliberately rebuilt — along with their entire dylib closure — 104 libraries, 85 MB — rewrites every load command to
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

Two ways to cut one, and neither involves editing a version by hand.

**From your machine:**

```bash
pnpm release          # says what it would do, changes nothing
pnpm release --yes    # version, commit, tag, push — the push starts the build
```

**From GitHub:** Actions → **Release** → *Run workflow*. Same script, run on the runner, so a
release needs no checkout at all.

Either way `scripts/release.mjs` picks the version, and it refuses to run from the wrong branch,
with a dirty tree, or behind `origin/main` — each of which is otherwise discovered *after* the tag
is pushed, which is the one point where undoing it means deleting a tag other people may have.

Versions are **`v<YY>.<MMDD>.<n>`** — `v26.826.0` is the first release on 26 August 2026,
`v26.826.1` the second that day. The script counts existing tags for today and takes the next
number. It reads as "how old is this" rather than as a promise about compatibility, which is the
honest thing for an app nobody builds against.

The shape is forced by `electron-updater`, which parses both versions with `semver` and throws
`ERR_UPDATER_INVALID_VERSION` on anything else — `isUpdateAvailable` is private, so there is no
comparator to replace. That rules out the two obvious ideas:

| | |
| --- | --- |
| `26.8.26.2` | not valid semver — three numeric parts, no more |
| `26.8.26-2` | valid, but a *prerelease*: it sorts **below** `26.8.26`, so the hotfix would never be offered |

`MMDD` in the minor slot survives both and still sorts: `26.826.1 < 26.827.0 < 26.1231.0 <
27.101.0`, because the parts compare as numbers. No leading zeros anywhere — January 1st is
`27.101.0`, not `27.0101.0`.

The mac target builds a **zip as well as the DMG**. The DMG is what a person downloads; the zip is
what Squirrel.Mac applies an update from, and without it the updater finds a release it cannot
install. Both are published; only the DMG needs to be linked.

The workflow uploads a **draft** release. Open it on GitHub, paste the note below, and press
Publish — the draft step exists so a bad build can be deleted before anyone sees it.

### The three bundled tools are downloaded, not built

ffmpeg, pdftotext and pdfinfo ship inside the DMG. Homebrew has no versioned formula for any of
them and upgrades them under you, so "install ffmpeg on the build machine" means a different ffmpeg
every few weeks — the first CI release proved it, arriving with **8.1.2** where this was tested with
**7.1.1**, and poppler **26.07.0** against **25.05.0**. That difference is invisible in a DMG and
surfaces as a book that extracts differently on somebody else's machine.

So the built bundle is the artefact. `scripts/pins.json` holds its URL and sha256, `desktop-build.sh`
downloads and verifies it exactly like `uv` and `bun`, and no build machine needs Homebrew for it.
It lives in a `tools-N` GitHub release, which is not an app release.

Rebuilding it is deliberate:

```bash
brew upgrade ffmpeg poppler
python3 scripts/bundle-tools.py           # refuses unless the versions match pins.json
# extract and synthesize a real book with the new versions
python3 scripts/bundle-tools.py --update-pins
tar -czf pdf2audio-tools-arm64.tar.gz -C packages/desktop/resources bin
gh release create tools-2 pdf2audio-tools-arm64.tar.gz --latest=false
# then put the new url + sha256 in pins.json
```

### Ad-hoc signing, and why "damaged" is not the same as "unsigned"

There is no Developer ID yet, but leaving the app *unsigned* is not the neutral choice it sounds
like. electron-builder without an identity leaves only the linker's partial signature, and macOS
assesses that as

```
code has no resources but signature indicates they must be present
```

which it presents to the user as **"pdf2audio is damaged and can't be opened. You should move it to
the Bin"** — with Move to Bin as the only button, and no entry in Privacy & Security to override.
The first release shipped exactly that, and the only way past it was a Terminal command.

`mac.identity: "-"` makes electron-builder sign the bundle and every nested framework and helper
ad-hoc, properly. The signature then verifies (`codesign --verify --deep --strict` passes) and
Gatekeeper's verdict drops to a plain `rejected` — the ordinary "unidentified developer" refusal,
which **Open Anyway** in Privacy & Security can override. Same absence of a certificate, a
recoverable wall instead of a dead end.

### The note an unsigned release needs

Without an Apple certificate macOS refuses the download, and the message it shows —
*"pdf2audio is damaged and can't be opened"* — is a lie that costs you most of your downloads
unless the release says otherwise. Paste this:

> **First time opening it:** macOS will say the app is damaged or from an unidentified developer.
> It is neither — this build just is not signed with an Apple certificate yet.
>
> 1. Drag **pdf2audio** to your Applications folder.
> 2. Open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway**
>    next to the message about pdf2audio.
> 3. Confirm **Open**.
>
> On older macOS you can instead right-click the app → **Open** → **Open**.
>
> You also need **Docker Desktop** or **OrbStack** installed and running — the app explains this on
> first launch and links to both. The first start downloads about 2.4 GB and takes a while; later
> ones take seconds.

Until the certificate exists the in-app updater can find and download a new version but **cannot
install it**, so each release means downloading the DMG again. That is the whole argument for the
$99 account, in one sentence.

The shape is forced by `electron-updater`, which parses both versions with `semver` and throws
`ERR_UPDATER_INVALID_VERSION` on anything else — `isUpdateAvailable` is private, so there is no
comparator to replace. That rules out the two obvious ideas:

| | |
| --- | --- |
| `26.8.26.2` | not valid semver — three numeric parts, no more |
| `26.8.26-2` | valid, but a *prerelease*: it sorts **below** `26.8.26`, so the hotfix would never be offered |

`MMDD` in the minor slot survives both problems and still sorts: `26.826.1 < 26.827.0 < 26.1231.0 <
27.101.0`, because the parts compare as numbers. Note there are no leading zeros anywhere — January
1st is `27.101.0`, not `27.0101.0`.

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

### How an update actually lands

Nothing is pushed. Every check is a `GET` of `latest-mac.yml` — once when the window finishes
loading, then every six hours, because an audiobook app stays open for days and once-per-launch
would never fire for the people who never quit. Declining a version stops it asking about that
version until the app restarts.

What happens after "Download it" is four processes, only the first of which is ours:

1. **electron-updater** (in our process) downloads the zip to
   `~/Library/Caches/@pdf2audiodesktop-updater/pending/`.
2. It then starts a **local HTTP server** and points Electron's native `autoUpdater` at it, because
   Squirrel.Mac will only take an update from a URL it fetches itself. The log line
   `…zip requested by Squirrel.Mac, pipe …` is that hand-off — the file is piped from the copy
   already on disk, so the 185 MB is not downloaded twice.
3. **Squirrel.Mac** pulls it from localhost into `~/Library/Caches/dev.pdf2audio.app.ShipIt/`,
   unzips it there, and validates the unpacked app's code signature. *This is the step that fails
   without an Apple certificate* — nothing before it involves signing at all.
4. On `quitAndInstall`, Squirrel launches **ShipIt**, a 125 KB helper inside
   `Contents/Frameworks/Squirrel.framework`. It is a separate process for the obvious reason: the
   app cannot overwrite its own bundle while running. ShipIt waits for the app to exit, swaps the
   `.app` on disk, and relaunches it.

So the zip is unarchived by Squirrel, not by Electron and not by us, and the swap is done by a
helper that outlives the app.

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

### Turning signing on

Nothing in the code changes. The workflow already branches on whether the certificate secret
exists — with it, electron-builder signs and notarises; without it, it ad-hoc signs and warns. What
follows is the one-time setup.

**1. Enrol.** [developer.apple.com/programs](https://developer.apple.com/programs/) — $99/year.
*Individual* means the signer shown is your legal name and takes days; *organisation* means a
company name, needs a D-U-N-S number, and takes weeks. Moving from individual to organisation later
is a **new membership and new certificates**, so it is the one decision here worth making slowly.
The product name is not part of any of this: one membership covers unlimited apps, and for
Developer ID distribution the bundle identifier is never registered anywhere.

**2. Create a Developer ID Application certificate.** Keychain Access → Certificate Assistant →
Request a Certificate From a Certificate Authority (saved to disk), upload it at
[Certificates](https://developer.apple.com/account/resources/certificates/list), choose **Developer
ID Application**, download and double-click the result.

**3. Export it for CI.** In Keychain Access, find *Developer ID Application: …*, expand it so both
the certificate and its private key are selected, right-click → Export as `.p12` with a password.
Then:

```bash
base64 -i certificate.p12 | pbcopy
```

**4. Create an App Store Connect API key** for notarisation at
[Users and Access → Integrations](https://appstoreconnect.apple.com/access/integrations/api), role
**Developer**. Download the `.p8` — it can only be downloaded once. This is preferred over an
app-specific password: it is scoped, revocable, and not tied to your Apple ID login.

**5. Add the repository secrets** (Settings → Secrets and variables → Actions):

| secret | what goes in it |
| --- | --- |
| `APPLE_CERTIFICATE` | the base64 from step 3 |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_TEAM_ID` | the 10-character team id, top right of the developer portal |
| `APPLE_API_KEY_ID` | the key id from step 4 |
| `APPLE_API_ISSUER` | the issuer id on the same page |
| `APPLE_API_KEY_PATH` | contents of the `.p8` |

The next tag signs, notarises, and publishes. Nothing else changes.

**What this is worth being careful about:** `APPLE_CERTIFICATE` is a private key that signs software
as you. Anyone who can write to this repository, or who compromises it, can sign anything with your
name on it. The certificate can be revoked from the portal if that ever happens, and it is worth
knowing that before uploading it rather than after.

### A macOS VM can only test half of this

`scripts/vm-verify.sh` runs inside a fresh `tart` macOS guest and is genuinely useful — it proved
the bundled ffmpeg and poppler run with no Homebrew on the machine, that the DMG opens somewhere it
was not built, and that the Docker panels say something a non-developer can act on.

It stops at Docker, permanently. Docker runs a Linux VM, which inside a guest needs nested
virtualization, and Apple offers that to **Linux guests only**:

```
$ tart run --nested p2a-test
macOS virtual machines do not support nested virtualization
```

Docker Desktop and OrbStack both install in there and then sit at "Starting" forever. So the
database, the Python environment, the models, the server and synthesis cannot be tested in a VM at
all — that half needs a second physical Mac.

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
