import { run, type Runner, type TaskList } from "graphile-worker";
import { extract } from "./extract.ts";
import { normalize } from "./normalize.ts";
import { synthesize } from "./synthesize.ts";
import { assemble } from "./assemble.ts";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

export const WORKER_CONCURRENCY = 4;

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

const taskList: TaskList = {
  extract: wrapTask("extract", extract),
  normalize: wrapTask("normalize", normalize),
  synthesize: wrapTask("synthesize", synthesize),
  assemble: wrapTask("assemble", (payload) => assemble(payload as any)),
};

let currentRunner: Runner | null = null;

export async function startWorker(): Promise<Runner> {
  currentRunner = await run({
    connectionString,
    concurrency: WORKER_CONCURRENCY,
    noHandleSignals: false,
    taskList,
  });
  return currentRunner;
}

export async function stopWorker(): Promise<void> {
  if (currentRunner) {
    await currentRunner.stop();
    currentRunner = null;
  }
}
