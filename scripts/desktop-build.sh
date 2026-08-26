#!/bin/bash
# Builds the desktop app, and optionally installs it over the copy in /Applications.
#
#   scripts/desktop-build.sh              build a .app and a .dmg
#   scripts/desktop-build.sh --install    …and replace /Applications/pdf2audio.app with it
#   scripts/desktop-build.sh --fast       skip the DMG; a .app is enough to test
#   scripts/desktop-build.sh --no-package  prepare resources only, for a signed build to package
#
# The install step exists because rebuilding proves nothing until the build is installed: it is
# easy to spend an afternoon reading the behaviour of the copy in /Applications while editing the
# one in release/.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
DESKTOP="$REPO/packages/desktop"
INSTALL=false; FAST=false; PACKAGE=true
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=true ;;
    --fast) FAST=true ;;
    --no-package) PACKAGE=false ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

# Bun compiles the server to one binary. Fetched here rather than made a prerequisite, the same way
# the app fetches uv — and pinned, because `bun build --compile` is what decides what the DMG
# contains and an unpinned installer changes that silently.
BUN_VERSION="1.3.9"
BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then
  BUN="$REPO/.bun/bin/bun"
  if [ ! -x "$BUN" ]; then
    echo "==> fetching bun $BUN_VERSION"
    curl -fsSL https://bun.sh/install | env BUN_INSTALL="$REPO/.bun" bash -s "bun-v$BUN_VERSION" >/dev/null
  fi
fi

# ffmpeg/pdftotext/pdfinfo are copied out of Homebrew, so this one genuinely is a prerequisite —
# saying so here beats failing three minutes in with a python traceback.
for tool in ffmpeg pdftotext; do
  command -v "$tool" >/dev/null || { echo "$tool is needed to build the bundle: brew install ffmpeg poppler"; exit 1; }
done

# Slow and rarely changing, so only when absent. Delete the folder to force them.
[ -d "$DESKTOP/resources/bin" ] || { echo "==> bundling ffmpeg, pdftotext, pdfinfo"; python3 scripts/bundle-tools.py; }
[ -f "$DESKTOP/build/icon.icns" ] || { echo "==> rendering the icon"; bash scripts/make-icon.sh; }

echo "==> building the web bundle"
pnpm --filter @pdf2audio/web build >/dev/null

echo "==> compiling the server"
mkdir -p "$DESKTOP/resources"
"$BUN" build --compile --target=bun-darwin-arm64 packages/server/src/main.ts \
  --outfile "$DESKTOP/resources/pdf2audio-server" >/dev/null
rm -rf "$DESKTOP/resources/web" && cp -R packages/web/dist "$DESKTOP/resources/web"

$PACKAGE || { echo "    resources staged; packaging left to the caller"; exit 0; }

echo "==> packaging"
cd "$DESKTOP"
# Unsigned on purpose until there is a certificate; without this electron-builder picks up any
# identity in the keychain and produces something that only signs on this machine.
export CSC_IDENTITY_AUTO_DISCOVERY=false
if $FAST; then npx electron-builder --mac --dir >/dev/null; else npx electron-builder --mac >/dev/null; fi

APP="$DESKTOP/release/mac-arm64/pdf2audio.app"
echo "    $APP"
$FAST || ls -lh "$DESKTOP"/release/*.dmg | awk '{print "    " $9 "  " $5}'

if $INSTALL; then
  echo "==> installing over /Applications"
  pkill -f "pdf2audio.app/Contents/MacOS" 2>/dev/null || true
  pkill -f "Resources/pdf2audio-server" 2>/dev/null || true
  rm -rf /Applications/pdf2audio.app
  cp -R "$APP" /Applications/
  # An unsigned app is quarantined the moment it comes off a DMG or a download. This is what
  # right-click → Open does, and it is the one step a real user cannot be asked to script.
  xattr -dr com.apple.quarantine /Applications/pdf2audio.app 2>/dev/null || true
  echo "    /Applications/pdf2audio.app  (quarantine cleared)"
fi
