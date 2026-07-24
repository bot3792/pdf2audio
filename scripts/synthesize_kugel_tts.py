#!/usr/bin/env python3

import argparse
import gc
import json
import os
import sys
from pathlib import Path


DEFAULT_MODEL_PATH = os.path.expanduser("~/.cache/pdf2audio-models/kugelaudio-0-open-4bit")
VOICES = {"default"}
CHUNK_SEPARATOR = "\f"
PAUSE_MS = 250
SAMPLE_RATE = 24000
CFG_SCALE = 3.0
DDPM_STEPS = 10


def resolve_checkpoint() -> Path:
    model_path = Path(os.environ.get("KUGEL_TTS_MODEL_PATH", DEFAULT_MODEL_PATH))
    if not model_path.exists():
        raise RuntimeError(
            f"KugelAudio model not found at {model_path}. Run scripts/setup.sh to download and quantize it."
        )
    return model_path


def load_pipeline(checkpoint: Path):
    import mlx.core as mx
    from mlx_audio.utils import apply_quantization, load_config, load_weights
    from mlx_audio.tts.models.kugelaudio import kugelaudio

    # mlx-audio 0.4.5's sanitize() transposes already-converted quantized weights;
    # load the local MLX checkpoint without it.
    config = load_config(checkpoint)
    config["model_path"] = str(checkpoint)
    model = kugelaudio.Model(kugelaudio.ModelConfig.from_dict(config))
    weights = load_weights(checkpoint)
    apply_quantization(model, config, weights, getattr(model, "model_quant_predicate", None))
    model.load_weights(list(weights.items()), strict=True)
    mx.eval(model.parameters())
    model.eval()
    return kugelaudio.Model.post_load_hook(model, checkpoint)


def synthesize_chunk_audio(model, text: str):
    import mlx.core as mx
    import numpy as np

    result = next(model.generate(text=text, cfg_scale=CFG_SCALE, ddpm_steps=DDPM_STEPS))
    mx.eval(result.audio)
    audio = np.asarray(result.audio, dtype=np.float32)
    if len(audio) == 0:
        raise RuntimeError("No audio was generated")
    return audio


def read_chunks(input_path: str) -> list[str]:
    text = Path(input_path).read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError("input text is empty")

    return [chunk.strip() for chunk in text.split(CHUNK_SEPARATOR) if chunk.strip()]


def write_chunk_manifest(chunks_dir: str, chunks: list[str]) -> None:
    os.makedirs(chunks_dir, exist_ok=True)
    manifest = [{"index": index, "text": chunk} for index, chunk in enumerate(chunks, start=1)]
    with open(os.path.join(chunks_dir, "chunks.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)


def load_existing_chunk(chunks_dir, index: int):
    """Return a previously-synthesized chunk's audio so resume can skip regenerating it."""
    if not chunks_dir:
        return None
    path = os.path.join(chunks_dir, f"chunk-{index:03d}.wav")
    if not os.path.exists(path):
        return None
    try:
        import soundfile as sf

        data, _ = sf.read(path, dtype="float32")
        return data if len(data) else None
    except Exception:
        return None


def main() -> None:
    import mlx.core as mx
    import numpy as np
    import soundfile as sf

    parser = argparse.ArgumentParser(description="Synthesize text to WAV using KugelAudio")
    parser.add_argument("--input", required=True, help="Path to chunked input text file")
    parser.add_argument("--output", required=True, help="Path to output WAV file")
    parser.add_argument("--voice", default="default", help="Voice name (only default)")
    parser.add_argument("--chunks-dir", default=None, help="Optional directory to persist per-chunk WAV previews")
    args = parser.parse_args()

    if args.voice not in VOICES:
        raise RuntimeError(f"Unsupported KugelAudio voice: {args.voice}")

    chunks = read_chunks(args.input)
    if args.chunks_dir:
        write_chunk_manifest(args.chunks_dir, chunks)
    checkpoint = resolve_checkpoint()
    model = load_pipeline(checkpoint)

    print(json.dumps({"type": "chunks", "total": len(chunks)}), flush=True)

    total_samples = 0
    silence = np.zeros(int(SAMPLE_RATE * PAUSE_MS / 1000), dtype=np.float32)

    with sf.SoundFile(args.output, mode="w", samplerate=SAMPLE_RATE, channels=1, format="WAV", subtype="FLOAT") as out_file:
        for index, chunk in enumerate(chunks, start=1):
            chunk_audio = load_existing_chunk(args.chunks_dir, index)
            if chunk_audio is None:
                chunk_audio = synthesize_chunk_audio(model, chunk)
                if args.chunks_dir:
                    os.makedirs(args.chunks_dir, exist_ok=True)
                    sf.write(os.path.join(args.chunks_dir, f"chunk-{index:03d}.wav"), chunk_audio, SAMPLE_RATE)
            out_file.write(chunk_audio)
            total_samples += len(chunk_audio)

            if index < len(chunks):
                out_file.write(silence)
                total_samples += len(silence)

            total_seconds = round(total_samples / SAMPLE_RATE, 1)
            print(json.dumps({
                "type": "progress",
                "chunk": index,
                "totalChunks": len(chunks),
                "audioSeconds": total_seconds,
            }), flush=True)

            del chunk_audio
            mx.clear_cache()
            gc.collect()

    if total_samples == 0:
        raise RuntimeError("No audio chunks were produced")

    total_seconds = round(total_samples / SAMPLE_RATE, 1)
    print(json.dumps({
        "type": "done",
        "audioSeconds": total_seconds,
        "chunks": len(chunks),
    }), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
