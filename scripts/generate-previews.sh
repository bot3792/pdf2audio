#!/bin/bash
set -e

PREVIEW_TEXT="The quick brown fox jumps over the lazy dog. A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with my whole heart."
DATA_DIR="${DATA_DIR:-./data}"
PREVIEWS_DIR="$DATA_DIR/previews"
CONDA_BIN="${CONDA_ENV_PATH:-/Users/petur/miniconda3/envs/pdf2audio/bin}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$PREVIEWS_DIR"

VOICES=(
  af_heart af_bella af_nicole af_aoede af_kore af_sarah af_alloy af_nova af_sky af_jessica af_river
  am_fenrir am_michael am_puck am_echo am_eric am_liam am_onyx am_adam
  bf_emma bf_isabella bf_alice bf_lily
  bm_george bm_fable bm_lewis bm_daniel
  ff_siwis
  ef_dora em_alex
  jf_alpha jf_gongitsune jf_tebukuro jf_nezumi jm_kumo
  zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi
  zm_yunjian zm_yunxi zm_yunxia zm_yunyang
)

TOTAL=${#VOICES[@]}
DONE=0

for VOICE in "${VOICES[@]}"; do
  DONE=$((DONE + 1))
  MP3="$PREVIEWS_DIR/$VOICE.mp3"

  if [ -f "$MP3" ]; then
    echo "[$DONE/$TOTAL] $VOICE — already exists, skipping"
    continue
  fi

  echo "[$DONE/$TOTAL] $VOICE — generating..."
  TXT="$PREVIEWS_DIR/$VOICE.txt"
  WAV="$PREVIEWS_DIR/$VOICE.wav"

  echo "$PREVIEW_TEXT" > "$TXT"

  LANG_CODE="${VOICE:0:1}"

  PYTORCH_ENABLE_MPS_FALLBACK=1 "$CONDA_BIN/python" "$SCRIPT_DIR/synthesize.py" \
    --input "$TXT" --output "$WAV" --voice "$VOICE" --speed 1.0 --lang "$LANG_CODE" \
    2>&1 | tail -1

  ffmpeg -y -i "$WAV" -codec:a libmp3lame -qscale:a 2 "$MP3" -loglevel error
  rm -f "$WAV" "$TXT"
done

echo ""
echo "Done. Generated previews in $PREVIEWS_DIR"
