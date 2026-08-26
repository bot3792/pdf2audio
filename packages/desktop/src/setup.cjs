// Everything scripts/setup.sh does, minus the terminal. Each function reports progress through a
// callback and is safe to run again — a first run that dies halfway resumes rather than restarts.
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, copyFileSync, cpSync, rmSync } = require("node:fs");
const path = require("node:path");

// Pinned and checksummed rather than `curl | sh`: piping an installer into a shell gives errors
// like "curl: (56) Failure writing output to destination" when anything goes wrong, which tells a
// user nothing, and it runs an unverified script as them.
const UV_VERSION = "0.12.5";
const UV_BUILDS = {
  arm64: { target: "aarch64-apple-darwin", sha256: "5bb0e5fe008a773c3dbcb97ff79cd89e1241464fe9d2f986d52ad8f1b037bd62" },
  x64: { target: "x86_64-apple-darwin", sha256: "b3b2137477cf96c9686ebfb71524614cec780c673fd73e59bce099aef02e70e8" },
};

// The three the workers shell out to. Homebrew is where they are on a developer machine; a GUI
// app's PATH has neither Homebrew directory, so look rather than trust $PATH.
const TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const TOOLS = ["ffmpeg", "pdftotext", "pdfinfo"];

function findTool(name) {
  for (const dir of TOOL_DIRS) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function missingTools() {
  return TOOLS.filter((t) => !findTool(t));
}

function toolPath() {
  return TOOL_DIRS.join(":");
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, env: { ...process.env, PATH: toolPath(), ...(opts.env || {}) } });
    let tail = "";
    const keep = (b) => { tail = (tail + String(b)).slice(-4000); opts.onOutput?.(String(b)); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(tail) : reject(new Error(tail.trim().split("\n").at(-1) || `exit ${code}`))));
  });
}

// The bundle is read-only in spirit and replaced wholesale by an update, so the pieces the runtime
// writes next to — the lockfile uv resolves against, the scripts it runs — are copied out once per
// version rather than referenced in place.
function stageRuntime(resources, home) {
  mkdirSync(home, { recursive: true });
  cpSync(path.join(resources, "scripts"), path.join(home, "scripts"), { recursive: true });
  for (const f of ["pyproject.toml", "uv.lock", "docker-compose.yml"]) {
    copyFileSync(path.join(resources, f), path.join(home, f));
  }
}

async function ensureUv(home, onOutput) {
  const dir = path.join(home, "uv");
  const uv = path.join(dir, "uv");
  if (existsSync(uv)) return uv;

  const build = UV_BUILDS[process.arch];
  if (!build) throw new Error(`No uv build for ${process.arch}`);
  mkdirSync(dir, { recursive: true });

  // Downloaded by the app rather than a browser, so it carries no quarantine flag and needs no
  // notarisation of ours — the same reason the Python environment lives out here at all.
  const tarball = path.join(dir, "uv.tar.gz");
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${build.target}.tar.gz`;
  onOutput?.(`Downloading uv ${UV_VERSION}`);
  await sh("/usr/bin/curl", ["-fsSL", "--retry", "3", "-o", tarball, url]);

  const got = (await sh("/usr/bin/shasum", ["-a", "256", tarball])).trim().split(/\s+/)[0];
  if (got !== build.sha256) {
    rmSync(tarball, { force: true });
    throw new Error(`uv checksum mismatch — expected ${build.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…`);
  }

  await sh("/usr/bin/tar", ["-xzf", tarball, "--strip-components=1", "-C", dir]);
  rmSync(tarball, { force: true });
  return uv;
}

async function syncPython(home, onOutput) {
  const uv = await ensureUv(home, onOutput);
  await sh(uv, ["sync", "--frozen", "--project", home], {
    // uv puts the environment beside pyproject.toml by default; this puts it where we want it
    env: { UV_PROJECT_ENVIRONMENT: path.join(home, "python") },
    onOutput,
  });
  return path.join(home, "python", "bin", "python");
}

async function fetchEssentialModels(python, home, onOutput) {
  await sh(python, [path.join(home, "scripts", "models.py"), "--essential"], {
    env: { HF_HUB_OFFLINE: "0" },
    onOutput,
  });
}

module.exports = { TOOLS, findTool, missingTools, toolPath, stageRuntime, ensureUv, syncPython, fetchEssentialModels, sh };
