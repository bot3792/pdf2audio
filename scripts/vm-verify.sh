#!/bin/bash
# Runs inside a fresh macOS VM to answer one question: does the DMG work on a machine that has
# never seen this project? Copy it in alongside the DMG and run it.
#
#   ./vm-verify.sh pdf2audio-0.0.1-arm64.dmg
#
# Everything it checks is something that has already been got wrong once on the host, where a
# stray Homebrew, a warm HuggingFace cache or an existing Postgres hid the problem.
set -uo pipefail

DMG="${1:-}"
[ -f "$DMG" ] || { echo "usage: $0 <path-to-dmg>"; exit 1; }

pass=0; fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi; }

echo "=== the machine, before anything ==="
echo "  macOS $(sw_vers -productVersion) on $(uname -m)"
# cirruslabs' base image ships Homebrew, so this is a note rather than a failure — what actually
# matters is that the three tools are absent, which is what makes the bundle the only source.
test -d /opt/homebrew/bin && echo "  NOTE  this image has Homebrew; the tool checks below are what matter"
check "no ffmpeg on PATH" '! command -v ffmpeg'
check "no pdftotext on PATH" '! command -v pdftotext'
check "no Python 3.12 on PATH" '! command -v python3.12'
check "no existing pdf2audio data" '! test -d "$HOME/Library/Application Support/pdf2audio"'
if ! command -v docker >/dev/null 2>&1 && ! test -S /var/run/docker.sock; then
  echo "  NOTE  Docker is not installed — the app should say so and stop, which is itself the test"
fi

echo
echo "=== install ==="
# An explicit mountpoint, because the volume name carries the version and a space —
# /Volumes/pdf2audio 0.0.1-arm64 — and parsing hdiutil's columns silently truncates it.
MOUNT=/tmp/p2a-dmg
rm -rf "$MOUNT" && mkdir -p "$MOUNT"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" >/dev/null || { echo "  could not mount $DMG"; exit 1; }
rm -rf /Applications/pdf2audio.app
cp -R "$MOUNT"/pdf2audio.app /Applications/ && echo "  copied to /Applications"
hdiutil detach "$MOUNT" -quiet
APP=$(ls -d /Applications/pdf2audio.app 2>/dev/null)
check "app is in /Applications" 'test -d "$APP"'

# Gatekeeper will refuse an unsigned build. Clearing quarantine is what a person does by
# right-click → Open; doing it here keeps the test about the app rather than about signing.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null && echo "  cleared quarantine (stands in for right-click → Open)"

echo
echo "=== the bundled tools, with no Homebrew to fall back on ==="
BIN="$APP/Contents/Resources/bin"
for t in ffmpeg pdftotext pdfinfo; do
  check "$t runs from the bundle" "env PATH=/usr/bin:/bin '$BIN/$t' $([ "$t" = ffmpeg ] && echo -version || echo -v)"
done

echo
echo "=== first run ==="
echo "  launching; this downloads ~2.8 GB and takes a while"
open -a "$APP"
for i in $(seq 1 30); do
  sleep 10
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3034/ || true)
  [ "$code" = "200" ] && break
  printf "\r  waiting… %ds  (last HTTP %s)" $((i * 10)) "${code:-none}"
done
echo
check "the app serves its UI" 'test "$(curl -s -o /dev/null -w %{http_code} --max-time 5 http://localhost:3034/)" = 200'
check "the API answers" 'curl -sf --max-time 5 http://localhost:3034/trpc/folders.list'
check "Python was installed by the app" 'test -x "$HOME/Library/Application Support/pdf2audio/python/bin/python"'
check "the Kokoro voice was fetched" 'test -d "$HOME/.cache/huggingface/hub/models--hexgrad--Kokoro-82M"'
check "it can narrate" 'printf "A test." > /tmp/t.txt && "$HOME/Library/Application Support/pdf2audio/python/bin/python" "$HOME/Library/Application Support/pdf2audio/scripts/synthesize.py" --input /tmp/t.txt --output /tmp/t.wav --voice af_heart && test -s /tmp/t.wav'

echo
echo "=== $pass passed, $fail failed ==="
exit $((fail > 0))
