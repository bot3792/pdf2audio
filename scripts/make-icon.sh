#!/bin/bash
# Turns the app mark into the .icns the bundle wants.
#
#   scripts/make-icon.sh [packages/desktop/icons/icon-solid.svg]
#
# The source is the SVG rather than a PNG so every size is rendered rather than resampled — at
# 16pt a downscaled 1024 bitmap turns the sound waves to mush. The mark is drawn on a filled plate
# because macOS gives an app icon no background of its own, and a transparent glyph in the dock
# reads as a broken icon rather than a minimal one.
set -euo pipefail

SRC="${1:-packages/desktop/icons/icon-solid.svg}"
OUT="${2:-packages/desktop/build/icon.icns}"
PLATE="#fffdf9"   # the paper the mark is drawn against in icon-solid.svg
[ -f "$SRC" ] || { echo "no icon at $SRC"; exit 1; }
command -v rsvg-convert >/dev/null || { echo "needs rsvg-convert (brew install librsvg)"; exit 1; }
# ImageMagick 6 calls this `convert`, so checking for the name we actually invoke
command -v magick >/dev/null || { echo "needs ImageMagick 7 (brew install imagemagick)"; exit 1; }

SET=$(mktemp -d)/icon.iconset
mkdir -p "$SET" "$(dirname "$OUT")"

render() {  # size, outfile
  # 12% padding: macOS art is drawn inside the icon grid, not edge to edge
  local size=$1 inner=$(( $1 * 76 / 100 )) pad
  pad=$(( (size - inner) / 2 ))
  rsvg-convert -w "$inner" -h "$inner" "$SRC" -o "$SET/.glyph.png"
  magick -size "${size}x${size}" "xc:$PLATE" \
    \( "$SET/.glyph.png" \) -geometry "+${pad}+${pad}" -composite \
    \( -size "${size}x${size}" xc:none -draw "roundrectangle 0,0 $((size-1)),$((size-1)) $((size*22/100)),$((size*22/100))" \) \
    -alpha set -compose DstIn -composite "$2"
  rm -f "$SET/.glyph.png"
}

for size in 16 32 128 256 512; do
  render "$size" "$SET/icon_${size}x${size}.png"
  render "$((size * 2))" "$SET/icon_${size}x${size}@2x.png"
done

iconutil -c icns "$SET" -o "$OUT"
rm -rf "$(dirname "$SET")"
echo "$OUT  ($(du -h "$OUT" | cut -f1))"
