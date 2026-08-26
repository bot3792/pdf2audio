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

## What is not here yet

The Electron main process and the first-run window. Deliberately last, and deliberately thin: the
app is a local web server and a page, so the wrapper starts child processes and opens a window.
Everything with logic in it lives above, where it can be tested without a display.

`main.ts` will need roughly: `preflight()` on launch, render the steps, `startDatabase()`,
`uv sync`, `startServer()`, `waitForServer()`, then point a `BrowserWindow` at the url. Plus an
**Open in your browser** menu item — the app serves on localhost, so any browser works, and that is
the escape hatch if a platform's webview renders badly.
