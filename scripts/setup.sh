#!/bin/bash
set -e

echo "=== pdf2audio setup ==="

echo ""
echo "Checking system dependencies..."
command -v ffmpeg >/dev/null 2>&1 || { echo "Missing: brew install ffmpeg"; exit 1; }
command -v espeak-ng >/dev/null 2>&1 || { echo "Missing: brew install espeak-ng"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Missing: python3"; exit 1; }
echo "  ffmpeg: $(which ffmpeg)"
echo "  espeak-ng: $(which espeak-ng)"
echo "  python3: $(python3 --version)"

echo ""
echo "Installing Python dependencies..."
pip3 install marker-pdf kokoro soundfile mlx-lm mlx mlx-audio numpy huggingface_hub torch
pip3 install "nanocodec-mlx @ git+https://github.com/nineninesix-ai/nanocodec-mlx.git"
# mlx-audio pulls transformers 5.x, which breaks marker-pdf (surya needs transformers.onnx)
pip3 install "transformers==4.57.6" "regex<2025.0.0"

echo ""
echo "Verifying marker..."
python3 -c "import marker; print(f'  marker: {marker.__version__}')" 2>/dev/null || echo "  marker: installed (version check N/A)"

echo ""
echo "Verifying kokoro..."
python3 -c "from kokoro import KPipeline; print('  kokoro: OK')"

echo ""
echo "Caching Qwen3.6 model for chapter detection (~16 GB)..."
python3 -c "from mlx_lm import load; load('mlx-community/Qwen3.6-27B-4bit'); print('  qwen3.6: OK')" 2>/dev/null || echo "  qwen3.6: download manually with: python3 -c \"from mlx_lm import load; load('mlx-community/Qwen3.6-27B-4bit')\""

echo ""
echo "Caching Bulgarian narrator model..."
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('raditotev/bg-tts-v5-mlx'); print('  bg-tts-v5-mlx: OK')" 2>/dev/null || echo "  bg-tts-v5-mlx: download manually with: python3 -c \"from huggingface_hub import snapshot_download; snapshot_download('raditotev/bg-tts-v5-mlx')\""

echo ""
echo "Verifying Meta MMS runtime..."
python3 -c "from transformers import AutoTokenizer, VitsModel; print('  mms runtime: OK')"

echo ""
echo "Caching Meta MMS Bulgarian model..."
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('facebook/mms-tts-bul'); print('  mms-tts-bul: OK')" 2>/dev/null || echo "  mms-tts-bul: download manually with: python3 -c \"from huggingface_hub import snapshot_download; snapshot_download('facebook/mms-tts-bul')\""

echo ""
echo "Preparing KugelAudio narrator (downloads ~17 GB once, quantizes to ~5 GB, then deletes the download)..."
KUGEL_DIR="$HOME/.cache/pdf2audio-models/kugelaudio-0-open-4bit"
if [ -d "$KUGEL_DIR" ]; then
  echo "  kugelaudio 4-bit: already present"
else
  python3 -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen2.5-7B', allow_patterns=['tokenizer*', 'vocab*', 'merges*', 'config.json'])"
  python3 -m mlx_audio.convert --hf-path kugelaudio/kugelaudio-0-open --mlx-path "$KUGEL_DIR" -q --q-bits 4 --model-domain tts \
    && python3 -c "from huggingface_hub import scan_cache_dir; c = scan_cache_dir(); [c.delete_revisions(*[r.commit_hash for r in repo.revisions]).execute() for repo in c.repos if repo.repo_id == 'kugelaudio/kugelaudio-0-open']" \
    && echo "  kugelaudio 4-bit: OK" \
    || echo "  kugelaudio: conversion failed — rerun or synthesize with another voice"
fi

echo ""
echo "Creating data directories..."
mkdir -p data/{uploads,tmp,output}

echo ""
echo "Installing Node.js dependencies..."
pnpm install

echo ""
echo "Checking Docker..."
command -v docker >/dev/null 2>&1 || { echo "Missing: install Docker Desktop"; exit 1; }
echo "  docker: $(docker --version)"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env  (if not done already)"
echo "  2. pnpm db:up            (start Postgres in Docker)"
echo "  3. pnpm db:generate && pnpm db:migrate"
echo "  4. pnpm dev              (start server + web)"
