#!/bin/bash
# Turns one square PNG into the .icns the app bundle wants.
#
#   scripts/make-icon.sh packages/desktop/icon.png
#
# Drop a new 1024x1024 PNG at that path and run this again; electron-builder picks up the .icns
# on the next build. Transparency is preserved, so artwork with a transparent background gets the
# rounded-square treatment macOS expects rather than a square pasted on the dock.
set -euo pipefail

SRC="${1:-packages/desktop/icon.png}"
OUT="${2:-packages/desktop/build/icon.icns}"
[ -f "$SRC" ] || { echo "no icon at $SRC"; exit 1; }

W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
[ "$W" -ge 1024 ] || echo "warning: $SRC is ${W}px; 1024 gives the sharpest result"

SET=$(mktemp -d)/icon.iconset
mkdir -p "$SET" "$(dirname "$OUT")"
for size in 16 32 128 256 512; do
  sips -z $size $size "$SRC" --out "$SET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$SRC" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$OUT"
rm -rf "$(dirname "$SET")"
echo "$OUT  ($(du -h "$OUT" | cut -f1))"
