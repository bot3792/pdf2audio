import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { env } from "../env.ts";
import { pocketVoicesDir } from "./paths.ts";

export const POCKET_SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/synthesize_pocket_tts.py");
export const pocketPython = () => path.join(env.POCKET_ENV_PATH, "python");

export type PocketVoiceLicense = "CC0" | "CC BY 4.0" | "CC BY-NC 4.0" | "unverified";

export type PocketVoice = {
  id: string;
  name: string;
  license: PocketVoiceLicense;
  note: string;
};

// Licenses come from the voices' source datasets, mapped in pocket_tts/utils/utils.py
// (_ORIGINS_OF_PREDEFINED_VOICES) — see docs/tts-licensing.md before any paid deployment.
export const POCKET_VOICES: PocketVoice[] = [
  { id: "alba", name: "Alba", license: "CC BY 4.0", note: "Voice-acted" },
  { id: "anna", name: "Anna", license: "CC BY 4.0", note: "VCTK" },
  { id: "vera", name: "Vera", license: "CC BY 4.0", note: "VCTK" },
  { id: "fantine", name: "Fantine", license: "CC BY 4.0", note: "VCTK" },
  { id: "charles", name: "Charles", license: "CC BY 4.0", note: "VCTK" },
  { id: "paul", name: "Paul", license: "CC BY 4.0", note: "VCTK" },
  { id: "eponine", name: "Eponine", license: "CC BY 4.0", note: "VCTK" },
  { id: "azelma", name: "Azelma", license: "CC BY 4.0", note: "VCTK" },
  { id: "george", name: "George", license: "CC BY 4.0", note: "VCTK" },
  { id: "mary", name: "Mary", license: "CC BY 4.0", note: "VCTK" },
  { id: "jane", name: "Jane", license: "CC BY 4.0", note: "VCTK" },
  { id: "michael", name: "Michael", license: "CC BY 4.0", note: "VCTK" },
  { id: "eve", name: "Eve", license: "CC BY 4.0", note: "VCTK" },
  { id: "marius", name: "Marius", license: "CC0", note: "Voice donation" },
  { id: "javert", name: "Javert", license: "CC0", note: "Voice donation" },
  { id: "bill_boerst", name: "Bill Boerst", license: "CC0", note: "LibriVox" },
  { id: "peter_yearsley", name: "Peter Yearsley", license: "CC0", note: "LibriVox" },
  { id: "stuart_bell", name: "Stuart Bell", license: "CC0", note: "LibriVox" },
  { id: "caro_davy", name: "Caro Davy", license: "CC0", note: "LibriVox" },
  { id: "giovanni", name: "Giovanni", license: "CC BY 4.0", note: "Italian speaker" },
  { id: "lola", name: "Lola", license: "CC BY 4.0", note: "Spanish speaker" },
  { id: "juergen", name: "Juergen", license: "CC BY 4.0", note: "German speaker" },
  { id: "rafael", name: "Rafael", license: "CC BY 4.0", note: "Portuguese speaker" },
  { id: "estelle", name: "Estelle", license: "unverified", note: "French speaker" },
  { id: "cosette", name: "Cosette", license: "CC BY-NC 4.0", note: "Expresso" },
  { id: "jean", name: "Jean", license: "CC BY-NC 4.0", note: "EARS" },
];

const POCKET_VOICE_IDS = new Set(POCKET_VOICES.map((voice) => voice.id));

export function isPocketCatalogVoice(voiceId: string): boolean {
  return POCKET_VOICE_IDS.has(voiceId);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function pocketEngineInstalled(): Promise<boolean> {
  return pathExists(pocketPython());
}

function hfCacheRoot(): string {
  return process.env.HF_HOME
    ? path.join(process.env.HF_HOME, "hub")
    : path.join(os.homedir(), ".cache", "huggingface", "hub");
}

// The gated cloning weights live in kyutai/pocket-tts; the catalog-only weights come from
// kyutai/pocket-tts-without-voice-cloning, which needs no account. Presence on disk is the
// honest signal — a token can be set without setup.sh having fetched anything.
export async function pocketCloningAvailable(): Promise<boolean> {
  const snapshots = path.join(hfCacheRoot(), "models--kyutai--pocket-tts", "snapshots");
  let entries: string[];
  try {
    entries = await readdir(snapshots);
  } catch {
    return false;
  }
  const found = await Promise.all(
    entries.map((entry) => pathExists(path.join(snapshots, entry, "languages", "english", "model.safetensors"))),
  );
  return found.some(Boolean);
}

const CUSTOM_VOICE_PREFIX = "custom:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPocketCustomVoice(voice: string): boolean {
  return voice.startsWith(CUSTOM_VOICE_PREFIX) && UUID_PATTERN.test(voice.slice(CUSTOM_VOICE_PREFIX.length));
}

export function customVoiceStatePath(voice: string): string {
  return path.join(pocketVoicesDir, `${voice.slice(CUSTOM_VOICE_PREFIX.length)}.safetensors`);
}

// Catalog voices pass through as names; cloned voices become a state file the subprocess loads.
export async function resolvePocketVoiceArg(voice: string): Promise<string> {
  if (!isPocketCustomVoice(voice)) return voice;
  const statePath = customVoiceStatePath(voice);
  if (!(await pathExists(statePath))) {
    throw new Error("That cloned voice no longer exists — pick another voice in the picker");
  }
  return statePath;
}

export function isValidCustomVoiceId(id: string): boolean {
  return UUID_PATTERN.test(id);
}
