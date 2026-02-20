import { run, type Runner, type TaskList } from "graphile-worker";
import { extract } from "./extract.ts";
import { normalize } from "./normalize.ts";
import { synthesize } from "./synthesize.ts";
import { assemble } from "./assemble.ts";

const connectionString = process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";

export const WORKER_CONCURRENCY = 4;

const taskList: TaskList = {
  extract: async (payload, helpers) => {
    await extract(payload as any, helpers);
  },
  normalize: async (payload, helpers) => {
    await normalize(payload as any, helpers);
  },
  synthesize: async (payload, helpers) => {
    await synthesize(payload as any, helpers);
  },
  assemble: async (payload, helpers) => {
    await assemble(payload as any);
  },
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
