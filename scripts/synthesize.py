#!/usr/bin/env python3
"""Kokoro TTS synthesis script. Runs on Apple Silicon with MPS acceleration."""

import argparse
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

    audio_chunks = []
    for result in pipeline(text, voice=args.voice, speed=args.speed):
        if result.audio is not None:
            audio_chunks.append(result.audio.numpy())

    if not audio_chunks:
        print("Error: no audio generated", file=sys.stderr)
        sys.exit(1)

    full_audio = np.concatenate(audio_chunks)
    sf.write(args.output, full_audio, 24000)
    print(f"Written {len(full_audio) / 24000:.1f}s of audio to {args.output}")


if __name__ == "__main__":
    main()
