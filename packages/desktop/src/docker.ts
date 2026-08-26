import { access, constants } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// A GUI app launched from Finder gets PATH=/usr/bin:/bin:/usr/sbin:/sbin — no /usr/local/bin, no
// /opt/homebrew/bin. `docker` lives in neither, so probing $PATH reports "no Docker" on machines
// that are running it perfectly well. These are where the four common runtimes put things.
export const CLI_CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  "/usr/bin/docker",
];

export const SOCKET_CANDIDATES = [
  "/var/run/docker.sock",
  path.join(homedir(), ".docker/run/docker.sock"),
  path.join(homedir(), ".orbstack/run/docker.sock"),
  path.join(homedir(), ".colima/default/docker.sock"),
  path.join(homedir(), ".rd/docker.sock"),
];

export type DockerState =
  | { kind: "ready"; cli: string; version: string }
  | { kind: "installed-not-running"; cli: string }
  | { kind: "missing" };

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await access(p, constants.F_OK).then(() => true, () => false)) return p;
  }
  return null;
}

export async function findDockerCli(candidates = CLI_CANDIDATES): Promise<string | null> {
  return firstExisting(candidates);
}

export async function findDockerSocket(candidates = SOCKET_CANDIDATES): Promise<string | null> {
  return firstExisting(candidates);
}

// A socket that exists is not a daemon that answers — Docker Desktop leaves one behind when it is
// quit — so the CLI still has the last word on whether anything is actually running.
export async function detectDocker(): Promise<DockerState> {
  const cli = await findDockerCli();
  if (!cli) return { kind: "missing" };

  const socket = await findDockerSocket();
  const env = { ...process.env, ...(socket ? { DOCKER_HOST: `unix://${socket}` } : {}) };
  try {
    const { stdout } = await run(cli, ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000, env });
    const version = stdout.trim();
    return version ? { kind: "ready", cli, version } : { kind: "installed-not-running", cli };
  } catch {
    return { kind: "installed-not-running", cli };
  }
}

export function dockerAdvice(state: DockerState): string {
  if (state.kind === "ready") return `Docker ${state.version}`;
  if (state.kind === "installed-not-running") return "Docker is installed but not running — start it, then check again.";
  return "pdf2audio keeps your library in Postgres, which runs in Docker. Install Docker Desktop or OrbStack, then check again.";
}
