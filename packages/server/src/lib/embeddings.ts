import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import path from "node:path";
import { env } from "../env.ts";

const EMBED_SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/embed_bge_m3.py");
const IDLE_KILL_MS = 5 * 60 * 1000;
const BATCH_TIMEOUT_MS = 5 * 60 * 1000;
const QUERY_TIMEOUT_MS = 20_000;

type Pending = { resolve: (vectors: number[][]) => void; reject: (err: Error) => void };

let proc: ChildProcessWithoutNullStreams | null = null;
let rl: Interface | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let idleTimer: NodeJS.Timeout | null = null;

function shutdown(reason: string) {
  const current = proc;
  proc = null;
  ready = null;
  rl?.close();
  rl = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  current?.kill("SIGKILL");
  for (const [, p] of pending) p.reject(new Error(reason));
  pending.clear();
}

function touchIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size === 0) {
      console.log("[embeddings] Idle — stopping BGE-M3 process");
      shutdown("Embedding process stopped while idle");
    }
  }, IDLE_KILL_MS);
}

function ensureProcess(): Promise<void> {
  if (proc && ready) return ready;

  const pythonBin = path.join(env.CONDA_ENV_PATH, "python");
  console.log("[embeddings] Starting BGE-M3 process");
  const child = spawn(pythonBin, [EMBED_SCRIPT], {
    env: {
      ...process.env,
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
      HF_HUB_OFFLINE: "1",
      PATH: `${env.CONDA_ENV_PATH}:${process.env.PATH}`,
    },
  });
  proc = child;

  let stderrBuf = "";
  child.stderr.on("data", (data: Buffer) => {
    stderrBuf = (stderrBuf + data.toString()).slice(-4000);
  });

  ready = new Promise<void>((resolve, reject) => {
    const reader = createInterface({ input: child.stdout });
    rl = reader;
    let isReady = false;
    reader.on("line", (line) => {
      let msg: { type?: string; id?: number; vectors?: number[][]; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        isReady = true;
        resolve();
        return;
      }
      if (msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.vectors) p.resolve(msg.vectors);
      else p.reject(new Error(msg.error ?? "Embedding failed"));
    });
    child.on("error", (err) => {
      if (!isReady) reject(err);
      shutdown(`Embedding process error: ${err.message}`);
    });
    child.on("close", (code) => {
      const reason = `Embedding process exited (code ${code}): ${stderrBuf.trim().slice(-500)}`;
      if (!isReady) reject(new Error(reason));
      if (proc === child) {
        console.log(`[embeddings] ${reason}`);
        shutdown(reason);
      }
    });
  });
  return ready;
}

export async function embedTexts(texts: string[], timeoutMs = BATCH_TIMEOUT_MS): Promise<number[][]> {
  if (texts.length === 0) return [];
  await ensureProcess();
  const child = proc;
  if (!child) throw new Error("Embedding process is not running");
  const id = nextId++;
  const result = new Promise<number[][]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Embedding timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
  child.stdin.write(JSON.stringify({ id, texts }) + "\n");
  touchIdleTimer();
  return result;
}

// Chat path: never blocks a search on a broken embedder — callers fall back to FTS-only
export async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const [vector] = await embedTexts([text], QUERY_TIMEOUT_MS);
    return vector ?? null;
  } catch (err) {
    console.log(`[embeddings] Query embedding unavailable: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function stopEmbeddings() {
  if (proc) shutdown("Embedding process stopped");
}
