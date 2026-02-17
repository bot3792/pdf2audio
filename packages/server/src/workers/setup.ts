import { run, type TaskList } from "graphile-worker";
import { extract } from "./extract.ts";
import { normalize } from "./normalize.ts";
import { synthesize } from "./synthesize.ts";
import { assemble } from "./assemble.ts";

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

export async function startWorker() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio",
    concurrency: 2,
    noHandleSignals: false,
    taskList,
  });

  return runner;
}
