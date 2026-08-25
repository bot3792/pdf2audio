import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPTS = path.resolve(import.meta.dirname, "../../../../scripts");

type Token = { text: string; whitespace: string; start_ts: number | null; end_ts: number | null };

const word = (text: string, start: number, end: number, whitespace = " "): Token =>
  ({ text, whitespace, start_ts: start, end_ts: end });
// What Kokoro hands back for a dash or a quote its aligner could not place
const untimed = (text: string, whitespace = ""): Token =>
  ({ text, whitespace, start_ts: null, end_ts: null });

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

// write_chunk_words is the only place a word timing is ever recorded, and it runs in Python.
// Importing the module needs nothing but the standard library, so this drives the real function
// rather than a transcription of it.
async function writeWords(tokens: Token[]): Promise<Array<{ text: string; after: string; startMs: number; endMs: number }> | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "kokoro-words-"));
  dirs.push(dir);
  const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
from synthesize import write_chunk_words

class Token:
    def __init__(self, d): self.__dict__.update(d)

write_chunk_words(${JSON.stringify(dir)}, 1, [Token(d) for d in json.loads(sys.argv[1])])
`;
  await run("python3", ["-c", driver, JSON.stringify(tokens)]);
  const file = path.join(dir, "chunk-001.words.json");
  return await readFile(file, "utf-8").then(JSON.parse).catch(() => null);
}

const rebuild = (words: Array<{ text: string; after: string }>) =>
  words.map((w) => w.text + w.after).join("").trim();

describe("write_chunk_words", () => {
  it("keeps the chunk's timings when a dash comes back untimed", async () => {
    // Frankenstein ch. X: one em-dash in 69 tokens took the word timings off the whole chunk,
    // and the chapter fell from word granularity to sentence because of it
    const words = (await writeWords([
      word("I", 100, 200),
      word("exclaimed", 200, 900, " "),
      untimed("-"),
      word('"', 900, 950),
      word("Wandering", 950, 1500, ""),
    ]))!;

    expect(words).not.toBeNull();
    expect(words.map((w) => w.text)).toEqual(["I", "exclaimed", '"', "Wandering"]);
    expect(rebuild(words)).toBe('I exclaimed -" Wandering');
  });

  it("folds a token that carries no text at all into the word before it", async () => {
    const words = (await writeWords([
      word("joy", 0, 500, ""),
      { text: "", whitespace: " ", start_ts: 500, end_ts: 500 },
      word("again", 500, 900, ""),
    ]))!;

    expect(rebuild(words)).toBe("joy again");
  });

  it("still gives up when a real word has no timing, rather than placing it wrongly", async () => {
    expect(
      await writeWords([word("the", 0, 100), untimed("sunlight", " "), word("clouds", 400, 900)]),
    ).toBeNull();
  });
});
