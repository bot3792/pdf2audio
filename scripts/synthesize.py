#!/usr/bin/env python3
"""Kokoro TTS synthesis script. Runs on Apple Silicon with MPS acceleration."""

import argparse
import json
import os
import re
import sys
import numpy as np


def write_chunk_manifest(chunks_dir, chunk_texts):
    os.makedirs(chunks_dir, exist_ok=True)
    manifest = [{"index": index, "text": text} for index, text in enumerate(chunk_texts, start=1)]
    with open(os.path.join(chunks_dir, "chunks.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)


def write_chunk_words(chunks_dir, index, tokens):
    """Per-word timings, chunk-relative ms, written beside the chunk WAV so a resumed run
    keeps the timings of the chunks it skips."""
    if not chunks_dir:
        return
    words = []
    for token in tokens:
        start, end = getattr(token, "start_ts", None), getattr(token, "end_ts", None)
        if start is None or end is None:
            return
        if not token.text:
            continue
        words.append({
            "text": token.text,
            "after": token.whitespace or "",
            "startMs": round(start * 1000),
            "endMs": round(end * 1000),
        })
    if not words:
        return
    os.makedirs(chunks_dir, exist_ok=True)
    with open(os.path.join(chunks_dir, f"chunk-{index:03d}.words.json"), "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)


def load_existing_chunk(chunks_dir, index):
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


def main():
    parser = argparse.ArgumentParser(description="Synthesize text to WAV using Kokoro TTS")
    parser.add_argument("--input", required=True, help="Path to input text file")
    parser.add_argument("--output", required=True, help="Path to output WAV file")
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice name")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed")
    parser.add_argument("--lang", default=None, help="Language code override (a/b/e/f/h/i/j/p/z)")
    parser.add_argument("--chunks-dir", default=None, help="Optional directory to persist per-chunk WAV previews")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("Error: input text is empty", file=sys.stderr)
        sys.exit(1)

    lang_code = args.lang or args.voice[0]

    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    import torch
    from kokoro import KPipeline
    import soundfile as sf

    device = "mps" if torch.backends.mps.is_available() else None
    pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", device=device)

    phoneme_chunks = []
    chunk_texts = []
    chunk_tokens = []
    for segment in re.split(r'\n+', text):
        segment = segment.strip()
        if not segment:
            continue
        try:
            ps, tokens = pipeline.g2p(segment)
            if tokens is None:
                # espeak-backed languages (fr/es/it/pt/hi) return phonemes with no token
                # structure; en_tokenize is English-only, so chunk the segment as-is and let
                # the MAX_PHONEMES splitter below cut it to size.
                if ps.strip():
                    phoneme_chunks.append(ps)
                    chunk_texts.append(segment)
                    chunk_tokens.append(None)
            else:
                for gs, chunk_ps, tks in pipeline.en_tokenize(tokens):
                    if chunk_ps.strip():
                        phoneme_chunks.append(chunk_ps)
                        chunk_texts.append(gs.strip())
                        chunk_tokens.append(tks)
        except Exception as e:
            print(f"G2P error on segment: {e}", file=sys.stderr)
            continue

    MAX_PHONEMES = 510
    safe_chunks = []
    safe_texts = []
    safe_tokens = []
    for ps, gs, tks in zip(phoneme_chunks, chunk_texts, chunk_tokens):
        # Cutting the phoneme string desynchronizes it from the token list, so every piece of
        # a split chunk goes without word timings rather than with wrong ones.
        was_split = len(ps) > MAX_PHONEMES
        while len(ps) > MAX_PHONEMES:
            split_at = ps.rfind(' ', 0, MAX_PHONEMES)
            if split_at <= 0:
                split_at = MAX_PHONEMES
            safe_chunks.append(ps[:split_at])
            safe_texts.append(gs)
            safe_tokens.append(None)
            ps = ps[split_at:].lstrip()
        if ps.strip():
            safe_chunks.append(ps)
            safe_texts.append(gs)
            safe_tokens.append(None if was_split else tks)
    phoneme_chunks = safe_chunks
    chunk_texts = safe_texts
    chunk_tokens = safe_tokens

    total_chunks = len(phoneme_chunks)
    if total_chunks == 0:
        print("Error: no phoneme chunks produced", file=sys.stderr)
        sys.exit(1)

    if args.chunks_dir:
        write_chunk_manifest(args.chunks_dir, chunk_texts)

    print(json.dumps({
        "type": "chunks",
        "total": total_chunks,
    }), flush=True)

    voice_pack = pipeline.load_voice(args.voice)
    audio_chunks = []
    for i, ps in enumerate(phoneme_chunks):
        chunk_audio = load_existing_chunk(args.chunks_dir, i + 1)
        if chunk_audio is None:
            output = KPipeline.infer(pipeline.model, ps, voice_pack, args.speed)
            chunk_audio = output.audio.numpy()
            if chunk_tokens[i] is not None and output.pred_dur is not None:
                KPipeline.join_timestamps(chunk_tokens[i], output.pred_dur)
                write_chunk_words(args.chunks_dir, i + 1, chunk_tokens[i])
            if args.chunks_dir:
                os.makedirs(args.chunks_dir, exist_ok=True)
                sf.write(os.path.join(args.chunks_dir, f"chunk-{i + 1:03d}.wav"), chunk_audio, 24000)
        audio_chunks.append(chunk_audio)
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
