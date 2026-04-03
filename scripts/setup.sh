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
pip3 install marker-pdf kokoro soundfile mlx-lm mlx numpy huggingface_hub
pip3 install "nanocodec-mlx @ git+https://github.com/nineninesix-ai/nanocodec-mlx.git"

echo ""
echo "Verifying marker..."
python3 -c "import marker; print(f'  marker: {marker.__version__}')" 2>/dev/null || echo "  marker: installed (version check N/A)"

echo ""
echo "Verifying kokoro..."
python3 -c "from kokoro import KPipeline; print('  kokoro: OK')"

echo ""
echo "Caching Qwen2.5 model for chapter detection..."
python3 -c "from mlx_lm import load; load('mlx-community/Qwen2.5-1.5B-Instruct-4bit'); print('  qwen2.5: OK')" 2>/dev/null || echo "  qwen2.5: download manually with: python3 -c \"from mlx_lm import load; load('mlx-community/Qwen2.5-1.5B-Instruct-4bit')\""

echo ""
echo "Caching Bulgarian narrator model..."
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('raditotev/bg-tts-v5-mlx'); print('  bg-tts-v5-mlx: OK')" 2>/dev/null || echo "  bg-tts-v5-mlx: download manually with: python3 -c \"from huggingface_hub import snapshot_download; snapshot_download('raditotev/bg-tts-v5-mlx')\""

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
