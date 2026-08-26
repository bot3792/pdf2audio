import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "../env.ts";
import { scriptPath } from "./paths.ts";
import { DownloadTracker } from "./downloads.ts";

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

// In-flight runs live only in memory: a finished download is read straight from the cache by the
// next subprocess, with no restart.
const downloads = new DownloadTracker();

// A status call is ~130 ms of interpreter start, and two gated surfaces can mount at once. Sharing
// the in-flight promise is what actually collapses that — caching only the result leaves the
// window where the subprocess is still running, which is exactly when the second caller arrives.
let cache: { at: number; bundles: PythonBundle[] } | null = null;
let pending: Promise<PythonBundle[]> | null = null;
const CACHE_MS = 1_000;

// scripts/models.py treats this file as "pretend these bundles are missing". A debugging aid that
// takes a second to apply is a bad debugging aid, so its presence skips the cache outright.
const FORCED_MISSING_FILE = path.resolve(env.SCRIPTS_DIR, "..", ".models-missing");

// The two read paths, which need stdout back; downloads go through DownloadTracker.
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
  if (existsSync(FORCED_MISSING_FILE)) cache = null;
  // Nothing can finish installing while its own download is running, so polling a download does
  // not need to keep starting interpreters to be told what the inFlight set already knows.
  else if (cache && (downloads.active > 0 || Date.now() - cache.at < CACHE_MS)) return cache.bundles;
  if (pending) return pending;
  // Rejecting rather than answering "[]" — an empty list is indistinguishable from "everything is
  // installed" by the time it reaches the gate, which turns a broken Python env into silently
  // enabled buttons on exactly the machine the gating exists for.
  pending = new Promise<PythonBundle[]>((resolve, reject) => {
    run(["--status"], (code, out) => {
      if (code !== 0) return reject(new Error(`Could not read model status: ${out.trim().split("\n").at(-1) || `exit ${code ?? "?"}`}`));
      try {
        resolve(JSON.parse(out) as PythonBundle[]);
      } catch {
        reject(new Error("Could not read model status: models.py did not return JSON"));
      }
    });
  }).finally(() => { pending = null; });
  const bundles = await pending;
  cache = { at: Date.now(), bundles };
  return bundles;
}

// Whether MLX works cannot change while the process runs, so this is asked once and kept.
let capabilities: Promise<{ mlx: boolean }> | null = null;

export function readCapabilities(): Promise<{ mlx: boolean }> {
  // Same rule as readStatus: the dev marker skips the cache outright, because a debugging aid that
  // takes a process restart to apply is a bad debugging aid.
  if (existsSync(FORCED_MISSING_FILE)) capabilities = null;
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
    downloading: downloads.downloading(b.id),
    error: downloads.error(b.id),
  }));
}

export function startBundleDownload(id: string): { started: boolean } {
  return downloads.start(id, python(), [MODELS_SCRIPT, "--download", id], () => { cache = null; });
}
