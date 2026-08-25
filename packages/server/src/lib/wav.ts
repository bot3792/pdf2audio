import { readFile } from "node:fs/promises";

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

export async function readWavPcm(wavPath: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(wavPath);
    return bytes.length > 44 ? bytes.subarray(44) : null;
  } catch {
    return null;
  }
}
