#!/usr/bin/env node
// Proves an ELEVENLABS_API_KEY works end to end before a chapter is pointed at it: lists the
// voices, reads the credit balance, and synthesizes one sentence with timestamps to confirm the
// tier really serves 24 kHz PCM and that the alignment rebuilds the text we sent — the invariant
// the whole read-along layer rests on. Costs about 44 characters.
//
// Usage: node scripts/elevenlabs-check.mjs [--voice <id>] [--model eleven_flash_v2_5] [--no-audio]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const env = await readFile(path.join(root, ".env"), "utf-8").catch(() => "");
const fromFile = Object.fromEntries(
  env.split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
const KEY = process.env.ELEVENLABS_API_KEY || fromFile.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("No ELEVENLABS_API_KEY in the environment or .env. Free key: https://elevenlabs.io/app/settings/api-keys");
  process.exit(1);
}

const MODEL = flag("--model", process.env.ELEVENLABS_MODEL || fromFile.ELEVENLABS_MODEL || "eleven_multilingual_v2");
const SENTENCE = "The quick brown fox jumps over the lazy dog.";
const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };

async function get(pathname) {
  const res = await fetch(`https://api.elevenlabs.io${pathname}`, { headers });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const subscription = await get("/v1/user/subscription");
const remaining = (subscription.character_limit ?? 0) - (subscription.character_count ?? 0);
console.log(`tier      ${subscription.tier ?? "unknown"}`);
console.log(`credits   ${remaining.toLocaleString()} left of ${(subscription.character_limit ?? 0).toLocaleString()}`);

const { voices = [] } = await get("/v2/voices?page_size=100");
console.log(`voices    ${voices.length} on the first page`);
for (const v of voices.slice(0, 5)) {
  const language = v.verified_languages?.[0]?.language ?? v.fine_tuning?.language ?? "?";
  console.log(`          ${v.voice_id}  ${(v.name ?? "").padEnd(18)} ${language}  ${v.labels?.accent ?? ""}`);
}

if (args.includes("--no-audio")) process.exit(0);

const voiceId = flag("--voice", voices[0]?.voice_id);
if (!voiceId) {
  console.error("No voice to test with — pass --voice <id>.");
  process.exit(1);
}
if (remaining < SENTENCE.length) {
  console.error(`Only ${remaining} credits left; the test sentence needs ${SENTENCE.length}.`);
  process.exit(1);
}

console.log(`\nsynthesizing ${SENTENCE.length} characters with ${MODEL} on ${voiceId}…`);
const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=pcm_24000`,
  { method: "POST", headers, body: JSON.stringify({ text: SENTENCE, model_id: MODEL }) },
);
if (!res.ok) {
  console.error(`FAILED ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}

const body = await res.json();
const pcm = Buffer.from(body.audio_base64 ?? "", "base64");
const chars = body.alignment?.characters ?? [];
const rebuilt = chars.join("");
const seconds = pcm.length / 2 / 24000;

console.log(`audio     ${pcm.length.toLocaleString()} bytes of pcm_24000 = ${seconds.toFixed(2)}s`);
console.log(`alignment ${chars.length} characters, ${rebuilt === SENTENCE ? "rebuilds the text exactly" : "DOES NOT MATCH what we sent"}`);
if (rebuilt !== SENTENCE) {
  console.log(`          sent:     ${JSON.stringify(SENTENCE)}`);
  console.log(`          returned: ${JSON.stringify(rebuilt)}`);
}

const out = path.join(root, "elevenlabs-check.wav");
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
await writeFile(out, Buffer.concat([header, pcm]));
console.log(`wrote     ${out}`);

const ok = rebuilt === SENTENCE && pcm.length > 0;
console.log(`\n${ok ? "PASS" : "FAIL"} — ${MODEL} on the ${subscription.tier ?? "?"} tier`);
process.exit(ok ? 0 : 1);
