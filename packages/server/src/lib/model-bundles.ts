import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "../env.ts";
import { scriptPath } from "./paths.ts";

export type ModelBundle = {
  id: string;
  label: string;
  unlocks: string;
  approxMb: number;
  appleSiliconOnly: boolean;
  installed: boolean;
  downloading: boolean;
  error: string | null;
};

type PythonBundle = Omit<ModelBundle, "downloading" | "error">;

const MODELS_SCRIPT = scriptPath("models.py");
const python = () => path.join(env.CONDA_ENV_PATH, "python");

// Same shape as the Pocket language downloads: in-flight runs live only in memory, because a
// finished download is read straight from the cache by the next subprocess with no restart.
const inFlight = new Set<string>();
const failures = new Map<string, string>();

// A status call is ~130 ms of interpreter start, and two gated surfaces can mount at once. One
// second is enough to collapse that without the answer ever being usefully stale.
let cache: { at: number; bundles: PythonBundle[] } | null = null;
const CACHE_MS = 1_000;

// scripts/models.py treats this file as "pretend these bundles are missing". A debugging aid that
// takes a second to apply is a bad debugging aid, so its presence skips the cache outright.
const FORCED_MISSING_FILE = path.resolve(env.SCRIPTS_DIR, "..", ".models-missing");

function run(args: string[], onExit: (code: number | null, stderr: string) => void) {
  const proc = spawn(python(), [MODELS_SCRIPT, ...args], {
    // The one path allowed to reach the network; everything else runs HF_HUB_OFFLINE=1
    env: { ...process.env, HF_HUB_OFFLINE: "0" },
  });
  let stdout = "";
  let stderr = "";
  // A failed spawn emits "error" and then "close" with an empty stderr, so without this the
  // useful message ("spawn …/python ENOENT") is overwritten by a generic "exit ?".
  let settled = false;
  const finish = (code: number | null, out: string) => {
    if (settled) return;
    settled = true;
    onExit(code, out);
  };
  proc.stdout.on("data", (b) => { stdout += String(b); });
  proc.stderr.on("data", (b) => { stderr = (stderr + String(b)).slice(-4000); });
  proc.on("close", (code) => finish(code, code === 0 ? stdout : stderr));
  proc.on("error", (err) => finish(null, err.message));
}

async function readStatus(): Promise<PythonBundle[]> {
  if (cache && Date.now() - cache.at < CACHE_MS && !existsSync(FORCED_MISSING_FILE)) return cache.bundles;
  // Rejecting rather than answering "[]" — an empty list is indistinguishable from "everything is
  // installed" by the time it reaches the gate, which turns a broken Python env into silently
  // enabled buttons on exactly the machine the gating exists for.
  const bundles = await new Promise<PythonBundle[]>((resolve, reject) => {
    run(["--status"], (code, out) => {
      if (code !== 0) return reject(new Error(`Could not read model status: ${out.trim().split("\n").at(-1) || `exit ${code ?? "?"}`}`));
      try {
        resolve(JSON.parse(out) as PythonBundle[]);
      } catch {
        reject(new Error("Could not read model status: models.py did not return JSON"));
      }
    });
  });
  cache = { at: Date.now(), bundles };
  return bundles;
}

// Whether MLX works cannot change while the process runs, so this is asked once and kept.
let capabilities: Promise<{ mlx: boolean }> | null = null;
let capabilitiesWereForced = false;

export function readCapabilities(): Promise<{ mlx: boolean }> {
  // Caching forever is right — MLX does not appear mid-process — but the dev marker has to be able
  // to turn it off and back on, so a change either way throws the cached answer away.
  const forced = existsSync(FORCED_MISSING_FILE);
  if (forced !== capabilitiesWereForced) capabilities = null;
  capabilitiesWereForced = forced;
  capabilities ??= new Promise<{ mlx: boolean }>((resolve, reject) => {
    run(["--capabilities"], (code, out) => {
      if (code !== 0) return reject(new Error(out.trim().split("\n").at(-1) || `exit ${code ?? "?"}`));
      try {
        resolve(JSON.parse(out) as { mlx: boolean });
      } catch {
        reject(new Error("models.py did not return JSON"));
      }
    });
  // "MLX is absent" is permanent; "we could not ask" is not, and caching the second one hides
  // every Metal voice until the process restarts, long after the user has fixed their env.
  }).catch((err) => {
    capabilities = null;
    throw err;
  });
  return capabilities;
}

export async function listModelBundles(): Promise<ModelBundle[]> {
  const bundles = await readStatus();
  return bundles.map((b) => ({
    ...b,
    downloading: inFlight.has(b.id),
    error: failures.get(b.id) ?? null,
  }));
}

export function startBundleDownload(id: string): { started: boolean } {
  if (inFlight.has(id)) return { started: false };
  inFlight.add(id);
  failures.delete(id);

  run(["--download", id], (code, out) => {
    inFlight.delete(id);
    cache = null;
    if (code !== 0) failures.set(id, out.trim().split("\n").at(-1) || `Download failed (exit ${code ?? "?"})`);
  });

  return { started: true };
}
