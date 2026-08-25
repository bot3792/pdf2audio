// Enough of a zip reader to open a read-along container, and no more. The alternative is a
// dependency for something the platform already does: DecompressionStream inflates, and a Blob
// slice of a stored entry is the file's own bytes, so audio and PDFs never pass through here.
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;
const EOCD_SIZE = 22;

type Entry = { name: string; header: number; compressedSize: number; size: number; method: number };

async function view(blob: Blob, start: number, end?: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

export class Zip {
  private urls = new Map<string, string>();

  private constructor(private blob: Blob, private entries: Map<string, Entry>) {}

  static async open(blob: Blob): Promise<Zip> {
    // The record is last unless the archive carries a comment, which is why it is searched for
    const tail = await view(blob, Math.max(0, blob.size - (0xffff + EOCD_SIZE)));
    let at = -1;
    for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD) { at = i; break; }
    }
    if (at === -1) throw new Error("Not a zip archive");

    const count = tail.getUint16(at + 10, true);
    const size = tail.getUint32(at + 12, true);
    const offset = tail.getUint32(at + 16, true);
    if (offset === 0xffffffff || count === 0xffff) throw new Error("Zip64 archives are not supported");

    const central = await view(blob, offset, offset + size);
    const names = new TextDecoder();
    const entries = new Map<string, Entry>();
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (central.getUint32(pos, true) !== CENTRAL) throw new Error("Damaged central directory");
      const nameLen = central.getUint16(pos + 28, true);
      const name = names.decode(new Uint8Array(central.buffer, central.byteOffset + pos + 46, nameLen));
      entries.set(name, {
        name,
        header: central.getUint32(pos + 42, true),
        compressedSize: central.getUint32(pos + 20, true),
        size: central.getUint32(pos + 24, true),
        method: central.getUint16(pos + 10, true),
      });
      pos += 46 + nameLen + central.getUint16(pos + 30, true) + central.getUint16(pos + 32, true);
    }
    return new Zip(blob, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  // The local header repeats the name and may carry different padding, so the data offset is
  // only knowable from the header itself — the central directory points at the header, not the data
  private async slice(name: string): Promise<Blob> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`${name} is not in this archive`);
    const local = await view(this.blob, entry.header, entry.header + 30);
    const start = entry.header + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    return this.blob.slice(start, start + entry.compressedSize);
  }

  async bytes(name: string): Promise<Blob> {
    const entry = this.entries.get(name)!;
    const slice = await this.slice(name);
    if (entry?.method === STORED) return slice;
    if (entry?.method !== DEFLATED) throw new Error(`${name} uses an unsupported compression method`);
    const stream = slice.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).blob();
  }

  async text(name: string): Promise<string> {
    return (await this.bytes(name)).text();
  }

  async json<T>(name: string): Promise<T> {
    return JSON.parse(await this.text(name)) as T;
  }

  // Held for the archive's lifetime: the same audio file is asked for on every seek, and a
  // revoked URL is a silently dead <audio src>
  async url(name: string): Promise<string> {
    const existing = this.urls.get(name);
    if (existing) return existing;
    const url = URL.createObjectURL(await this.bytes(name));
    this.urls.set(name, url);
    return url;
  }

  close(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
