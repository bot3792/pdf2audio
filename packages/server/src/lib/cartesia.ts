import { open, writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { env } from "../env.ts";
import { chunkTextForBulgarianNarrator } from "./tts-chunks.ts";

const CARTESIA_URL = "https://api.cartesia.ai";
const CARTESIA_VERSION = "2026-08-14";
const MODEL_ID = "sonic-3.5";
const SAMPLE_RATE = 44100;
const PAUSE_MS = 250;
const REQUEST_TIMEOUT_MS = 120_000;
const VOICE_CACHE_TTL_MS = 10 * 60_000;

export type CartesiaVoice = {
  id: string;
  name: string;
  language: string;
  gender: string | null;
  tagline: string;
};

export class CartesiaAbortedError extends Error {
  constructor() {
    super("Cartesia synthesis aborted");
    this.name = "CartesiaAbortedError";
  }
}

function apiKey(): string {
  if (!env.CARTESIA_API_KEY) throw new Error("CARTESIA_API_KEY is not set — add it to .env");
  return env.CARTESIA_API_KEY;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
  };
}

let voiceCache: { at: number; voices: CartesiaVoice[] } | null = null;

export async function listCartesiaVoices(): Promise<CartesiaVoice[]> {
  if (!env.CARTESIA_API_KEY) return [];
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_TTL_MS) return voiceCache.voices;

  const voices: CartesiaVoice[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const res = await fetch(`${CARTESIA_URL}/voices?${params}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Cartesia voices error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json()) as {
      data: { id: string; name: string; language: string; gender: string | null; tagline?: string | null }[];
      has_more: boolean;
    };
    voices.push(...body.data.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
      gender: v.gender,
      tagline: v.tagline ?? "",
    })));
    if (!body.has_more || body.data.length === 0) break;
    startingAfter = body.data[body.data.length - 1].id;
  }

  voiceCache = { at: Date.now(), voices };
  return voices;
}

export async function findCartesiaVoice(voiceId: string): Promise<CartesiaVoice | null> {
  const voices = await listCartesiaVoices().catch(() => [] as CartesiaVoice[]);
  return voices.find((v) => v.id === voiceId) ?? null;
}

async function synthesizeChunkPcm(voiceId: string, language: string | null, text: string, speed: number, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(`${CARTESIA_URL}/tts/bytes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model_id: MODEL_ID,
      transcript: text,
      voice: { id: voiceId },
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
      ...(language ? { language } : {}),
      // Cartesia accepts 0.6-1.5; the app-wide slider allows 0.5-2.0
      ...(speed !== 1 ? { generation_config: { speed: Math.min(1.5, Math.max(0.6, speed)) } } : {}),
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cartesia TTS error ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function pcm16WavHeader(dataBytes: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

async function readChunkPcm(wavPath: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(wavPath);
    return bytes.length > 44 ? bytes.subarray(44) : null;
  } catch {
    return null;
  }
}

type CartesiaSynthesizeOptions = {
  inputText: string;
  outputPath: string;
  voiceId: string;
  speed: number;
  chunkPreviewDir?: string | null;
  chunkPreviewUrlBase?: string | null;
  log?: (message: string) => Promise<void>;
  onProgress?: (chunk: number, totalChunks: number) => Promise<void>;
  signal?: AbortSignal;
};

export async function cartesiaSynthesize({
  inputText,
  outputPath,
  voiceId,
  speed,
  chunkPreviewDir = null,
  chunkPreviewUrlBase = null,
  log = async () => {},
  onProgress = async () => {},
  signal,
}: CartesiaSynthesizeOptions): Promise<void> {
  const chunks = chunkTextForBulgarianNarrator(inputText);
  if (chunks.length === 0) throw new Error("Narrator input is empty after chunking");

  const voice = await findCartesiaVoice(voiceId);
  const language = voice?.language ?? null;

  const wordCount = inputText.split(/\s+/).filter(Boolean).length;
  await log(`Starting Cartesia synthesis (${wordCount.toLocaleString()} words, voice: ${voice?.name ?? voiceId}, speed ${speed}x)`);
  if (chunkPreviewDir) {
    await mkdir(chunkPreviewDir, { recursive: true });
    const manifest = chunks.map((text, i) => ({ index: i + 1, text }));
    await writeFile(path.join(chunkPreviewDir, "chunks.json"), JSON.stringify(manifest), "utf-8");
  }
  if (chunkPreviewUrlBase) {
    await log(`Chunk previews: ${chunkPreviewUrlBase}/chunk-001.wav`);
  }

  const silence = Buffer.alloc(Math.round((SAMPLE_RATE * PAUSE_MS) / 1000) * 2);
  const out = await open(outputPath, "w");
  let dataBytes = 0;
  try {
    await out.write(pcm16WavHeader(0, SAMPLE_RATE));

    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw new CartesiaAbortedError();

      const chunkPath = chunkPreviewDir ? path.join(chunkPreviewDir, `chunk-${String(i + 1).padStart(3, "0")}.wav`) : null;
      let pcm = chunkPath ? await readChunkPcm(chunkPath) : null;
      if (!pcm) {
        try {
          pcm = await synthesizeChunkPcm(voiceId, language, chunks[i], speed, signal);
        } catch (err) {
          if (signal?.aborted) throw new CartesiaAbortedError();
          throw err;
        }
        if (chunkPath) {
          await writeFile(chunkPath, Buffer.concat([pcm16WavHeader(pcm.length, SAMPLE_RATE), pcm]));
        }
      }

      await out.write(pcm);
      dataBytes += pcm.length;
      if (i < chunks.length - 1) {
        await out.write(silence);
        dataBytes += silence.length;
      }

      const totalSeconds = Math.round(dataBytes / 2 / SAMPLE_RATE * 10) / 10;
      const previewSuffix = chunkPreviewUrlBase ? ` — ${chunkPreviewUrlBase}/chunk-${String(i + 1).padStart(3, "0")}.wav` : "";
      await log(`Chunk ${i + 1}/${chunks.length} — ${totalSeconds}s of audio${previewSuffix}`);
      await onProgress(i + 1, chunks.length);
    }

    const sizeHeader = pcm16WavHeader(dataBytes, SAMPLE_RATE);
    await out.write(sizeHeader, 0, sizeHeader.length, 0);
    const totalSeconds = Math.round(dataBytes / 2 / SAMPLE_RATE * 10) / 10;
    await log(`Synthesis complete — ${totalSeconds}s of audio in ${chunks.length} chunks`);
  } finally {
    await out.close();
  }
}
