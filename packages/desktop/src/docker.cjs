// Required by main.cjs, so it is .cjs: an Electron main process has no build step, and a second
// copy of these paths living in main.cjs is how the Colima and Rancher socket handling ended up
// tested but never shipped.
const { access, constants } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { homedir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);

// A GUI app launched from Finder gets PATH=/usr/bin:/bin:/usr/sbin:/sbin — no /usr/local/bin, no
// /opt/homebrew/bin. `docker` lives in neither, so probing $PATH reports "no Docker" on machines
// that are running it perfectly well. These are where the four common runtimes put things.
const CLI_CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  "/usr/bin/docker",
];

const SOCKET_CANDIDATES = [
  "/var/run/docker.sock",
  path.join(homedir(), ".docker/run/docker.sock"),
  path.join(homedir(), ".orbstack/run/docker.sock"),
  path.join(homedir(), ".colima/default/docker.sock"),
  path.join(homedir(), ".rd/docker.sock"),
];

async function firstExisting(paths) {
  for (const p of paths) {
    if (await access(p, constants.F_OK).then(() => true, () => false)) return p;
  }
  return null;
}

async function findDockerCli(candidates = CLI_CANDIDATES) {
  return firstExisting(candidates);
}

async function findDockerSocket(candidates = SOCKET_CANDIDATES) {
  return firstExisting(candidates);
}

// A socket that exists is not a daemon that answers — Docker Desktop leaves one behind when it is
// quit — so the CLI still has the last word on whether anything is actually running.
async function detectDocker() {
  const cli = await findDockerCli();
  if (!cli) return { kind: "missing" };

  const env = await dockerEnv();
  try {
    const { stdout } = await run(cli, ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000, env });
    const version = stdout.trim();
    return version ? { kind: "ready", cli, version, env } : { kind: "installed-not-running", cli };
  } catch {
    return { kind: "installed-not-running", cli };
  }
}

// Colima and Rancher Desktop never create /var/run/docker.sock, so without DOCKER_HOST every
// `docker` call fails and the app tells a working machine that Docker is not running.
async function dockerEnv() {
  const socket = await findDockerSocket();
  return { ...process.env, ...(socket ? { DOCKER_HOST: `unix://${socket}` } : {}) };
}

function dockerAdvice(state) {
  if (state.kind === "ready") return `Docker ${state.version}`;
  if (state.kind === "installed-not-running") return "Docker is installed but not running — start it, then check again.";
  return "pdf2audio keeps your library in Postgres, which runs in Docker. Install Docker Desktop or OrbStack, then check again.";
}

module.exports = { CLI_CANDIDATES, SOCKET_CANDIDATES, findDockerCli, findDockerSocket, detectDocker, dockerAdvice, dockerEnv };
