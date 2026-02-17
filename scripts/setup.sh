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
pip3 install marker-pdf kokoro soundfile

echo ""
echo "Verifying marker..."
python3 -c "import marker; print(f'  marker: {marker.__version__}')" 2>/dev/null || echo "  marker: installed (version check N/A)"

echo ""
echo "Verifying kokoro..."
python3 -c "from kokoro import KPipeline; print('  kokoro: OK')"

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
