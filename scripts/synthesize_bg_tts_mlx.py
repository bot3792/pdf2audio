#!/usr/bin/env python3

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


MODEL_ID = "raditotev/bg-tts-v5-mlx"
SPEAKER_IDS = {
    "default": 0,
    "narrator": 1,
}
CHUNK_SEPARATOR = "\f"
PAUSE_MS = 250


def resolve_checkpoint() -> str:
    model_path = os.environ.get("BG_TTS_MLX_MODEL_PATH")
    if model_path:
        return model_path

    from huggingface_hub import snapshot_download

    local_only = os.environ.get("HF_HUB_OFFLINE") == "1"
    return snapshot_download(MODEL_ID, local_files_only=local_only)


def load_synthesizer(checkpoint: str):
    sys.path.insert(0, checkpoint)
    try:
        from tts_mlx.inference import synthesize as mlx_synthesize
    except ImportError as exc:
        raise RuntimeError(
            "Could not import bg-tts-v5-mlx inference code. Cache the model repo and install MLX dependencies first."
        ) from exc

    return mlx_synthesize


def read_chunks(input_path: str) -> list[str]:
    text = Path(input_path).read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError("input text is empty")

    return [chunk.strip() for chunk in text.split(CHUNK_SEPARATOR) if chunk.strip()]


def main() -> None:
    import numpy as np
    import soundfile as sf

    parser = argparse.ArgumentParser(description="Synthesize Bulgarian text to WAV using bg-tts-v5-mlx")
    parser.add_argument("--input", required=True, help="Path to chunked input text file")
    parser.add_argument("--output", required=True, help="Path to output WAV file")
    parser.add_argument("--voice", default="narrator", help="Voice name (default or narrator)")
    args = parser.parse_args()

    speaker_id = SPEAKER_IDS.get(args.voice)
    if speaker_id is None:
        raise RuntimeError(f"Unsupported Bulgarian MLX voice: {args.voice}")

    chunks = read_chunks(args.input)
    checkpoint = resolve_checkpoint()
    mlx_synthesize = load_synthesizer(checkpoint)

    print(json.dumps({"type": "chunks", "total": len(chunks)}), flush=True)

    audio_parts: list[np.ndarray] = []
    sample_rate: int | None = None

    with tempfile.TemporaryDirectory(prefix="bg-tts-mlx-") as tmp_dir:
        for index, chunk in enumerate(chunks, start=1):
            chunk_output = os.path.join(tmp_dir, f"chunk-{index:03d}.wav")
            mlx_synthesize(
                checkpoint=checkpoint,
                text=chunk,
                output=chunk_output,
                speaker_id=speaker_id,
                temperature=0.25,
                top_k=50,
                top_p=0.8,
            )

            chunk_audio, chunk_rate = sf.read(chunk_output, dtype="float32")
            if chunk_audio.ndim > 1:
                chunk_audio = chunk_audio.mean(axis=1)

            if sample_rate is None:
                sample_rate = chunk_rate
            elif chunk_rate != sample_rate:
                raise RuntimeError(f"Inconsistent sample rate: {chunk_rate} != {sample_rate}")

            audio_parts.append(chunk_audio)

            if index < len(chunks):
                silence = np.zeros(int(chunk_rate * PAUSE_MS / 1000), dtype=np.float32)
                audio_parts.append(silence)

            total_samples = sum(len(part) for part in audio_parts)
            total_seconds = round(total_samples / chunk_rate, 1)
            print(json.dumps({
                "type": "progress",
                "chunk": index,
                "totalChunks": len(chunks),
                "audioSeconds": total_seconds,
            }), flush=True)

    if sample_rate is None or not audio_parts:
        raise RuntimeError("No audio chunks were produced")

    full_audio = np.concatenate(audio_parts)
    sf.write(args.output, full_audio, sample_rate)
    total_seconds = round(len(full_audio) / sample_rate, 1)
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
