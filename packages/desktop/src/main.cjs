// The window: this file starts child processes and points a BrowserWindow at a local url.
// Docker probing lives in docker.cjs, which is required rather than duplicated — an Electron main
// process has no build step, so a .ts module beside it would be tested and never shipped.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const { execFile, execFileSync, spawn } = require("node:child_process");

const path = require("node:path");
const setup = require("./setup.cjs");
const docker = require("./docker.cjs");

const PORT = Number(process.env.PDF2AUDIO_PORT || 3034);

// Everything the app installs for itself: the Python environment, the scripts it runs, the
// lockfile it resolves against. Never inside the bundle, which an update replaces wholesale.
function defaultHome() {
  return process.env.PDF2AUDIO_HOME || path.join(app.getPath("appData"), "pdf2audio");
}

// dataDir, databaseUrl, envFile: the three things a developer running both the app and a checkout
// needs to point at one copy instead of two. The data directory is not a preference — the database
// records absolute paths to every PDF and audio file, so pointing the app at a different directory
// than wrote them gives a library that lists books it cannot play.
function readConfig(home) {
  try {
    return JSON.parse(require("node:fs").readFileSync(path.join(home, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

let HOME = null;
let RESOURCES = null;
let CONFIG = {};
const DEFAULT_DATABASE_URL = "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";

let win = null;
let server = null;

function composeUp(cli, env) {
  return new Promise((resolve) => {
    execFile(cli, ["compose", "-f", path.join(HOME, "docker-compose.yml"), "up", "-d"], { timeout: 120000, env }, (err) =>
      resolve(!err));
  });
}

// A graceful quit kills the child, but a force quit or a crash cannot — the server keeps running
// and keeps serving, so the next launch finds the port taken and the one after that talks to a
// server from two versions ago. Adopting the orphan is not worth the complexity; ending it is.
function killOrphanedServers() {
  const bundled = path.join(RESOURCES, "pdf2audio-server");
  try {
    const out = execFileSync("/usr/bin/pgrep", ["-f", bundled], { encoding: "utf8" });
    for (const pid of out.split("\n").map((n) => Number(n.trim())).filter(Boolean)) {
      if (pid !== process.pid) {
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    }
  } catch {
    // pgrep exits non-zero when nothing matches, which is the common case
  }
}

function startServer(onDied) {
  killOrphanedServers();
  const bundled = path.join(RESOURCES, "pdf2audio-server");
  server = spawn(bundled, [], { env: serverEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  const keep = (b) => { tail = (tail + String(b)).slice(-2000); process.stdout.write(String(b)); };
  server.stdout?.on("data", keep);
  server.stderr?.on("data", keep);
  // Without these the common failures are invisible: a port already taken exits immediately and
  // the probe then succeeds against the *other* server, and a missing binary makes an unhandled
  // 'error' kill the main process with no window and no message.
  server.on("error", (err) => onDied(err.message));
  server.on("exit", (code, signal) => {
    if (server?.killed || signal === "SIGTERM") return;
    onDied(tail.trim().split("\n").at(-1) || `the server exited with code ${code}`);
  });
}

function serverEnv() {
  return {
    ...process.env,
    PDF2AUDIO_HOME: HOME,
    SCRIPTS_DIR: path.join(HOME, "scripts"),
    DATA_DIR: process.env.DATA_DIR || CONFIG.dataDir || path.join(HOME, "data"),
    CONDA_ENV_PATH: path.join(HOME, "python/bin"),
    POCKET_ENV_PATH: path.join(HOME, "python-pocket/bin"),
    WEB_DIR: path.join(RESOURCES, "web"),
    MIGRATIONS_DIR: path.join(RESOURCES, "drizzle"),
    DATABASE_URL: process.env.DATABASE_URL || CONFIG.databaseUrl || DEFAULT_DATABASE_URL,
    PDF2AUDIO_ENV_FILE: process.env.PDF2AUDIO_ENV_FILE || CONFIG.envFile || path.join(HOME, ".env"),
    PORT: String(PORT),
    // A GUI app's PATH omits Homebrew, and the workers spawn ffmpeg, pdftotext and pdfinfo
    PATH: setup.toolPath(RESOURCES),
  };
}

async function waitFor(url, timeoutMs, abandoned = () => false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (abandoned()) return false;
    const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

let booting = false;

async function boot() {
  if (booting) return;
  booting = true;
  try {
    await runBoot();
  } finally {
    booting = false;
  }
}

// The "Check again" button stays on screen while a blocked step is still blocked, which includes
// the whole of the multi-gigabyte Python step. Two of these at once means two `uv sync` runs
// against one environment and two servers racing to kill each other.
async function runBoot() {
  const send = (id, state, detail) => win?.webContents.send("step", { id, state, detail });

  HOME = defaultHome();
  CONFIG = readConfig(HOME);
  RESOURCES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "../resources");

  const missing = setup.missingTools(RESOURCES);
  if (missing.length) {
    return send("tools", "blocked", `Missing ${missing.join(", ")} from the app bundle — this build is incomplete.`);
  }
  send("tools", "done", "bundled");

  const state = await docker.detectDocker();
  if (state.kind !== "ready") return send("docker", "blocked", `${docker.dockerAdvice(state)} Then press Check again.`);
  send("docker", "done", docker.dockerAdvice(state));

  send("database", "running");
  if (!(await composeUp(state.cli, state.env))) {
    return send("database", "blocked", "Postgres would not start — check Docker has finished pulling, then press Check again.");
  }
  send("database", "done", "Postgres on port 5433");

  try {
    send("python", "running", "Installing Python and PyTorch — about 2.4 GB, once");
    setup.stageRuntime(RESOURCES, HOME);
    const python = await setup.syncPython(HOME, (line) => send("python", "running", line.trim().split("\n").at(-1)));
    send("python", "done");

    send("voice", "running", "Downloading the Kokoro voice — 347 MB");
    await setup.fetchEssentialModels(python, HOME, () => {});
    send("voice", "done");
  } catch (err) {
    return send("python", "blocked", String(err.message || err).slice(0, 200));
  }

  send("server", "running");
  let died = null;
  startServer((reason) => { died = reason; });
  const url = `http://localhost:${PORT}`;
  const ready = await waitFor(`${url}/trpc/folders.list`, 120000, () => died);
  if (died) return send("server", "blocked", died.slice(0, 200));
  if (!ready) return send("server", "blocked", "The server did not start — check Console.app for pdf2audio.");
  send("server", "done");
  win.loadURL(url);
}

function menu(url) {
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "View",
      submenu: [
        // The app is a local server and a page, so any browser works — and this is the way out if
        // the embedded webview ever renders something badly.
        { label: "Open in your browser", accelerator: "CmdOrCtrl+Shift+O", click: () => shell.openExternal(url) },
        { type: "separator" },
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Show data folder", click: () => shell.openPath(process.env.DATA_DIR || CONFIG.dataDir || path.join(HOME || "", "data")) },
        { label: "Where things live", click: () => dialog.showMessageBox({ message: `Everything the app installed: ${HOME}\nYour library: Postgres in Docker, port 5433\nServer: ${url}` }) },
      ],
    },
    { role: "windowMenu" },
  ]);
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1280, height: 860, title: "pdf2audio",
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  // The UI links out to Hacker News, publisher pages and whatever a digest cites. Electron's
  // default would open those in a chrome-less window that inherits this preload — an arbitrary
  // site with no address bar and `window.setup.recheck` on it. Send them to the real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`http://localhost:${PORT}`) && !target.startsWith("file://")) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  Menu.setApplicationMenu(menu(`http://localhost:${PORT}`));
  win.loadFile(path.join(__dirname, "first-run.html"));
  win.webContents.once("did-finish-load", boot);
  ipcMain.on("recheck", boot);

});

app.on("window-all-closed", () => {
  server?.kill();
  app.quit();
});
app.on("before-quit", () => server?.kill());
