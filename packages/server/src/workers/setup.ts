import { run, type Runner, type TaskList } from "graphile-worker";
import { extract } from "./extract.ts";
import { normalize } from "./normalize.ts";
import { synthesize } from "./synthesize.ts";
import { assemble } from "./assemble.ts";
import { assembleDocument } from "./assemble-document.ts";
import { redetect } from "./redetect.ts";
import { propose } from "./propose.ts";
import { translate } from "./translate.ts";
import { translateTitles } from "./translate-titles.ts";
import { cleanup } from "./cleanup.ts";
import { synthesizeTranslation } from "./synthesize-translation.ts";
import { sweepStrandedWork } from "./sweep.ts";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

function logTask(name: string, payload: Record<string, unknown>) {
  const bookId = (payload.bookId as string)?.slice(0, 8) ?? "?";
  const chapterId = (payload.chapterId as string)?.slice(0, 8);
  const label = chapterId ? `${name} (book ${bookId}, ch ${chapterId})` : `${name} (book ${bookId})`;
  return {
    label,
    start() { console.log(`[worker] Starting ${label}`); },
    done(ms: number) { console.log(`[worker] Completed ${label} (${(ms / 1000).toFixed(1)}s)`); },
    fail(ms: number, err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[worker] Failed ${label} (${(ms / 1000).toFixed(1)}s): ${msg}`);
    },
  };
}

function wrapTask<P extends Record<string, unknown>>(
  name: string,
  fn: (payload: P, helpers: any) => Promise<void>,
) {
  return async (payload: unknown, helpers: any) => {
    const p = payload as P;
    const t = logTask(name, p as Record<string, unknown>);
    const start = Date.now();
    t.start();
    try {
      await fn(p, helpers);
      t.done(Date.now() - start);
    } catch (err) {
      t.fail(Date.now() - start, err);
      throw err;
    }
  };
}

// Each pool only claims its own task_identifiers, so GPU-bound TTS can't starve
// CPU-bound extraction or network-bound translation.
export const WORKER_POOLS: { name: string; concurrency: number; taskList: TaskList }[] = [
  {
    name: "tts", // MLX contends for the GPU; >2 concurrent processes add little throughput
    concurrency: 2,
    taskList: {
      synthesize: wrapTask("synthesize", synthesize),
      synthesizeTranslation: wrapTask("synthesizeTranslation", synthesizeTranslation),
    },
  },
  {
    name: "extraction",
    concurrency: 1,
    taskList: {
      extract: wrapTask("extract", extract),
      normalize: wrapTask("normalize", normalize),
      redetect: wrapTask("redetect", (payload) => redetect(payload as any)),
      propose: wrapTask("propose", (payload) => propose(payload as any)),
    },
  },
  {
    name: "assembly", // ffmpeg concat / Vivliostyle render — independent of marker, must not queue behind a long extraction
    concurrency: 1,
    taskList: {
      assemble: wrapTask("assemble", (payload) => assemble(payload as any)),
      assembleDocument: wrapTask("assembleDocument", (payload) => assembleDocument(payload as any)),
    },
  },
  {
    name: "translate",
    concurrency: 3,
    taskList: {
      translate: wrapTask("translate", translate),
      translateTitles: wrapTask("translateTitles", (payload) => translateTitles(payload as any)),
      cleanup: wrapTask("cleanup", (payload) => cleanup(payload as any)),
    },
  },
];

let currentRunners: Runner[] = [];

export async function startWorker(): Promise<Runner[]> {
  // Before the runners start, so any lock in the jobs table is provably from a dead process
  try {
    await sweepStrandedWork();
  } catch (err) {
    console.error("[worker] Startup sweep failed:", err);
  }
  currentRunners = await Promise.all(
    WORKER_POOLS.map((pool) =>
      run({
        connectionString,
        concurrency: pool.concurrency,
        noHandleSignals: false,
        taskList: pool.taskList,
      }),
    ),
  );
  return currentRunners;
}

export async function stopWorker(): Promise<void> {
  await Promise.all(currentRunners.map((runner) => runner.stop()));
  currentRunners = [];
}
