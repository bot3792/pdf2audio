import { spawn } from "node:child_process";

import { POCKET_LANGUAGES, POCKET_SCRIPT, pocketLanguageInstalled, pocketPython, type PocketLanguage } from "./pocket.ts";

export type PocketLanguageState = {
  code: string;
  label: string;
  approxMb: number;
  realtimeFactor: number;
  note?: string;
  installed: boolean;
  downloading: boolean;
  error: string | null;
};

// Downloads land in the shared HF cache, which the synthesis subprocess reads at spawn time — so a
// finished download is live immediately, with no server restart. This map only tracks in-flight
// runs so the UI can show progress; it is intentionally lost on restart like the extract registry.
const inFlight = new Map<string, { error: string | null }>();
const failures = new Map<string, string>();

export async function listPocketLanguages(): Promise<PocketLanguageState[]> {
  const installed = await Promise.all(POCKET_LANGUAGES.map((l) => pocketLanguageInstalled(l.model)));
  return POCKET_LANGUAGES.map((language, i) => ({
    code: language.code,
    label: language.label,
    approxMb: language.approxMb,
    realtimeFactor: language.realtimeFactor,
    note: language.note,
    installed: installed[i],
    downloading: inFlight.has(language.code),
    error: failures.get(language.code) ?? null,
  }));
}

export function startPocketLanguageDownload(language: PocketLanguage): { started: boolean } {
  if (inFlight.has(language.code)) return { started: false };

  inFlight.set(language.code, { error: null });
  failures.delete(language.code);

  // HF_HUB_OFFLINE is deliberately NOT set here — this is the one path allowed to reach the network.
  const proc = spawn(pocketPython(), [POCKET_SCRIPT, "--cache-only", "--language", language.model], {
    env: { ...process.env, HF_HUB_OFFLINE: "0" },
  });

  let stderr = "";
  proc.stderr.on("data", (buf) => {
    stderr = (stderr + String(buf)).slice(-2000);
  });

  const finish = (message: string | null) => {
    inFlight.delete(language.code);
    if (message) failures.set(language.code, message);
  };

  proc.on("close", (code) => {
    finish(code === 0 ? null : stderr.trim().split("\n").at(-1) || `Download failed (exit ${code})`);
  });
  proc.on("error", (error) => finish(error.message));

  return { started: true };
}
