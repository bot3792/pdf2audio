#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$REPO_DIR/.venv"
POCKET_VENV_DIR="$REPO_DIR/.venv-pocket"
WITH_KUGEL=false
[ "${1:-}" = "--kugel" ] && WITH_KUGEL=true

echo "=== pdf2audio setup ==="

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This setup targets Apple Silicon Macs — the MLX TTS engines need Metal."
  exit 1
fi

echo ""
echo "Checking prerequisites..."
missing=()
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg (brew install ffmpeg)")
command -v espeak-ng >/dev/null 2>&1 || missing+=("espeak-ng (brew install espeak-ng)")
command -v pdftotext >/dev/null 2>&1 || missing+=("pdftotext (brew install poppler)")
command -v pnpm >/dev/null 2>&1 || missing+=("pnpm (npm install -g pnpm)")
if command -v node >/dev/null 2>&1; then
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || missing+=("Node.js >= 20 (brew install node)")
else
  missing+=("Node.js >= 20 (brew install node)")
fi

PYTHON=""
for cand in python3.12 /opt/homebrew/opt/python@3.12/bin/python3.12; do
  if command -v "$cand" >/dev/null 2>&1; then PYTHON="$(command -v "$cand")"; break; fi
done
[ -n "$PYTHON" ] || missing+=("Python 3.12 (brew install python@3.12)")

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing prerequisites:"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi
echo "  ffmpeg: $(which ffmpeg)"
echo "  espeak-ng: $(which espeak-ng)"
echo "  pdftotext: $(which pdftotext)"
echo "  python: $PYTHON ($("$PYTHON" --version))"
echo "  node: $(node --version), pnpm: $(pnpm --version)"
if command -v docker >/dev/null 2>&1; then
  echo "  docker: $(docker --version)"
else
  echo "  ! docker not found — continuing; install OrbStack or Docker Desktop before the database step"
fi

echo ""
echo "Creating Python environment at .venv..."
[ -x "$VENV_DIR/bin/python" ] || "$PYTHON" -m venv "$VENV_DIR"
PY="$VENV_DIR/bin/python"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install -r "$REPO_DIR/scripts/requirements.txt"
# --no-deps: these declare constraints the pinned set deliberately violates (see requirements.txt)
"$PY" -m pip install --no-deps mlx-lm==0.31.3 mlx-audio==0.4.5
"$PY" -m pip install --no-deps "nanocodec-mlx @ git+https://github.com/nineninesix-ai/nanocodec-mlx.git"

echo ""
echo "Verifying Python runtimes..."
"$PY" -c "import marker; print(f'  marker: {marker.__version__}')" 2>/dev/null || echo "  marker: installed (version check N/A)"
"$PY" -c "from kokoro import KPipeline; print('  kokoro: OK')"
"$PY" -c "from transformers import AutoTokenizer, VitsModel; print('  mms runtime: OK')"
"$PY" -c "import mlx.core; print('  mlx: OK')"

# Every TTS/extraction subprocess runs with HF_HUB_OFFLINE=1, so all models must be cached now.
echo ""
echo "Caching Kokoro model (~330 MB)..."
"$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('hexgrad/Kokoro-82M'); print('  Kokoro-82M: OK')"

echo ""
echo "Caching Marker extraction models (~2 GB, powers OCR extraction)..."
"$PY" -c "from marker.models import create_model_dict; create_model_dict(); print('  marker models: OK')"

echo ""
echo "Caching Bulgarian narrator model (~1 GB)..."
"$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('raditotev/bg-tts-v5-mlx'); print('  bg-tts-v5-mlx: OK')"

echo ""
echo "Caching Meta MMS Bulgarian model (~280 MB)..."
"$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('facebook/mms-tts-bul'); print('  mms-tts-bul: OK')"

echo ""
echo "Caching BGE-M3 embedding model (~2.2 GB, powers library search)..."
"$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('BAAI/bge-m3'); print('  bge-m3: OK')"

echo ""
# Separate venv: pocket-tts requires numpy>=2, the main env is pinned to numpy 1.26.4.
echo "Creating Pocket TTS environment at .venv-pocket..."
[ -x "$POCKET_VENV_DIR/bin/python" ] || "$PYTHON" -m venv "$POCKET_VENV_DIR"
POCKET_PY="$POCKET_VENV_DIR/bin/python"
"$POCKET_PY" -m pip install --quiet --upgrade pip
"$POCKET_PY" -m pip install --quiet -r "$REPO_DIR/scripts/requirements-pocket.txt"

# .env is written later in this script, so read the token straight out of it when present.
if [ -z "${HF_TOKEN:-}" ] && [ -f "$REPO_DIR/.env" ]; then
  HF_TOKEN="$(grep -E '^HF_TOKEN=.+' "$REPO_DIR/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
  export HF_TOKEN
fi

echo "Caching Pocket TTS model and catalog voices (~500 MB)..."
if [ -n "${HF_TOKEN:-}" ]; then
  echo "  HF_TOKEN set — will also fetch the gated voice-cloning weights"
else
  echo "  no HF_TOKEN — catalog voices only (cloning needs an account; see README)"
fi
"$POCKET_PY" "$REPO_DIR/scripts/synthesize_pocket_tts.py" --cache-only

echo ""
KUGEL_DIR="$HOME/.cache/pdf2audio-models/kugelaudio-0-open-4bit"
if [ -d "$KUGEL_DIR" ]; then
  echo "KugelAudio narrator: already present"
elif ! $WITH_KUGEL && [ -t 0 ]; then
  read -r -p "Download the KugelAudio narrator (24 EU languages)? Downloads ~17 GB once, quantizes to ~5 GB, then deletes the download. [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] && WITH_KUGEL=true
fi
if [ ! -d "$KUGEL_DIR" ] && $WITH_KUGEL; then
  echo "Preparing KugelAudio narrator..."
  "$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen2.5-7B', allow_patterns=['tokenizer*', 'vocab*', 'merges*', 'config.json'])"
  "$PY" -m mlx_audio.convert --hf-path kugelaudio/kugelaudio-0-open --mlx-path "$KUGEL_DIR" -q --q-bits 4 --model-domain tts \
    && "$PY" -c "from huggingface_hub import scan_cache_dir; c = scan_cache_dir(); [c.delete_revisions(*[r.commit_hash for r in repo.revisions]).execute() for repo in c.repos if repo.repo_id == 'kugelaudio/kugelaudio-0-open']" \
    && echo "  kugelaudio 4-bit: OK" \
    || echo "  kugelaudio: conversion failed — rerun 'pnpm run setup --kugel' or synthesize with another voice"
elif [ ! -d "$KUGEL_DIR" ]; then
  echo "KugelAudio narrator: skipped (run 'pnpm run setup --kugel' to add it later)"
fi

echo ""
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "Creating .env..."
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  printf 'CONDA_ENV_PATH=%s/bin\n' "$VENV_DIR" >> "$REPO_DIR/.env"
else
  echo ".env already exists — leaving it untouched"
fi

echo ""
echo "Installing Node.js dependencies..."
cd "$REPO_DIR"
pnpm install

echo ""
if docker info >/dev/null 2>&1; then
  echo "Starting Postgres and running migrations..."
  pnpm db:up
  pnpm db:migrate
else
  echo "Docker is not available — install/start OrbStack or Docker Desktop, then run:"
  echo "  pnpm db:up && pnpm db:migrate"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Start the app with: pnpm dev"
echo "  web: http://localhost:3033   api: http://localhost:3034"
echo ""
echo "Optional: add DEEPSEEK_API_KEY to .env for translations, rewrites, digests, Ask AI, and library chat."
