#!/usr/bin/env python3
"""Kokoro TTS synthesis script. Runs on Apple Silicon with MPS acceleration."""

import argparse
import json
import re
import sys
import numpy as np

def main():
    parser = argparse.ArgumentParser(description="Synthesize text to WAV using Kokoro TTS")
    parser.add_argument("--input", required=True, help="Path to input text file")
    parser.add_argument("--output", required=True, help="Path to output WAV file")
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice name")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed")
    parser.add_argument("--lang", default=None, help="Language code override (a/b/e/f/h/i/j/p/z)")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("Error: input text is empty", file=sys.stderr)
        sys.exit(1)

    lang_code = args.lang or args.voice[0]

    from kokoro import KPipeline
    import soundfile as sf

    pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")

    phoneme_chunks = []
    for segment in re.split(r'\n+', text):
        segment = segment.strip()
        if not segment:
            continue
        try:
            ps, tokens = pipeline.g2p(segment)
            for gs, ps, tks in pipeline.en_tokenize(tokens):
                if ps.strip():
                    phoneme_chunks.append(ps)
        except Exception as e:
            print(f"G2P error on segment: {e}", file=sys.stderr)
            continue

    total_chunks = len(phoneme_chunks)
    if total_chunks == 0:
        print("Error: no phoneme chunks produced", file=sys.stderr)
        sys.exit(1)

    print(json.dumps({
        "type": "chunks",
        "total": total_chunks,
    }), flush=True)

    voice_pack = pipeline.load_voice(args.voice)
    audio_chunks = []
    for i, ps in enumerate(phoneme_chunks):
        output = KPipeline.infer(pipeline.model, ps, voice_pack, args.speed)
        audio_chunks.append(output.audio.numpy())
        seconds = sum(len(c) for c in audio_chunks) / 24000
        print(json.dumps({
            "type": "progress",
            "chunk": i + 1,
            "totalChunks": total_chunks,
            "audioSeconds": round(seconds, 1),
        }), flush=True)

    full_audio = np.concatenate(audio_chunks)
    sf.write(args.output, full_audio, 24000)
    total_seconds = round(len(full_audio) / 24000, 1)
    print(json.dumps({
        "type": "done",
        "audioSeconds": total_seconds,
        "chunks": total_chunks,
    }), flush=True)


if __name__ == "__main__":
    main()
