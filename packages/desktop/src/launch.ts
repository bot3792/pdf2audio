import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

import { detectDocker, dockerAdvice, type DockerState } from "./docker.ts";

const run = promisify(execFile);

export type Step = { id: string; label: string; state: "pending" | "running" | "done" | "blocked"; detail?: string };

export const STEPS: Omit<Step, "state" | "detail">[] = [
  { id: "docker", label: "Docker" },
  { id: "database", label: "Database" },
  { id: "python", label: "Python and PyTorch" },
  { id: "voice", label: "Kokoro voice" },
  { id: "server", label: "Starting pdf2audio" },
];

// Docker is the one prerequisite the app cannot install for someone, so it is the one step that
// blocks rather than fails: the window keeps offering "Check again" instead of giving up.
export function dockerStep(state: DockerState): Step {
  return {
    id: "docker",
    label: "Docker",
    state: state.kind === "ready" ? "done" : "blocked",
    detail: dockerAdvice(state),
  };
}

export async function startDatabase(composeFile: string, cli: string): Promise<void> {
  await run(cli, ["compose", "-f", composeFile, "up", "-d"], { timeout: 120_000 });
}

export async function stopDatabase(composeFile: string, cli: string): Promise<void> {
  await run(cli, ["compose", "-f", composeFile, "stop"], { timeout: 60_000 }).catch(() => {});
}

export type ServerHandle = { process: ChildProcess; url: string };

export function startServer(serverBin: string, home: string, port: number, databaseUrl: string): ServerHandle {
  const child = spawn(serverBin, [], {
    env: {
      ...process.env,
      PDF2AUDIO_HOME: home,
      DATA_DIR: `${home}/data`,
      SCRIPTS_DIR: `${home}/scripts`,
      CONDA_ENV_PATH: `${home}/python/bin`,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { process: child, url: `http://127.0.0.1:${port}` };
}

// Polling beats parsing the log: the server prints several "listening" lines, one per interface,
// and the only question that matters is whether a request comes back.
export async function waitForServer(url: string, timeoutMs = 60_000, now = () => Date.now()): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const ok = await fetch(`${url}/trpc/folders.list`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function preflight(): Promise<Step[]> {
  const docker = await detectDocker();
  const first = dockerStep(docker);
  return [first, ...STEPS.slice(1).map((s) => ({ ...s, state: first.state === "done" ? ("pending" as const) : ("blocked" as const) }))];
}
