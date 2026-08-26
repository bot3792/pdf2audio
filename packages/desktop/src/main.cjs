// The window. Everything with logic in it is in docker.ts / launch.ts, tested without a display —
// this file starts child processes and points a BrowserWindow at a local url.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const setup = require("./setup.cjs");

const PORT = Number(process.env.PDF2AUDIO_PORT || 3034);

// Everything the app installs for itself: the Python environment, the scripts it runs, the
// lockfile it resolves against. Never inside the bundle, which an update replaces wholesale.
function defaultHome() {
  return process.env.PDF2AUDIO_HOME || path.join(app.getPath("appData"), "pdf2audio");
}

let HOME = null;
let RESOURCES = null;
const DATABASE_URL = process.env.DATABASE_URL || "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";

const CLI_CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  "/usr/bin/docker",
];

let win = null;
let server = null;

function dockerCli() {
  return CLI_CANDIDATES.find(existsSync) || null;
}

function dockerReady(cli) {
  return new Promise((resolve) => {
    execFile(cli, ["version", "--format", "{{.Server.Version}}"], { timeout: 10000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim() || null));
  });
}

function composeUp(cli) {
  return new Promise((resolve) => {
    execFile(cli, ["compose", "-f", path.join(HOME, "docker-compose.yml"), "up", "-d"], { timeout: 120000 }, (err) =>
      resolve(!err));
  });
}

function startServer() {
  const bundled = path.join(RESOURCES, "pdf2audio-server");
  server = spawn(bundled, [], { env: serverEnv(), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (b) => process.stdout.write(String(b)));
  server.stderr?.on("data", (b) => process.stderr.write(String(b)));
}

function serverEnv() {
  return {
    ...process.env,
    PDF2AUDIO_HOME: HOME,
    SCRIPTS_DIR: path.join(HOME, "scripts"),
    DATA_DIR: path.join(HOME, "data"),
    CONDA_ENV_PATH: path.join(HOME, "python/bin"),
    POCKET_ENV_PATH: path.join(HOME, "python-pocket/bin"),
    WEB_DIR: path.join(RESOURCES, "web"),
    DATABASE_URL,
    PORT: String(PORT),
    // A GUI app's PATH omits Homebrew, and the workers spawn ffmpeg, pdftotext and pdfinfo
    PATH: setup.toolPath(RESOURCES),
  };
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

async function boot() {
  const send = (id, state, detail) => win?.webContents.send("step", { id, state, detail });

  HOME = defaultHome();
  RESOURCES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "../resources");

  const missing = setup.missingTools(RESOURCES);
  if (missing.length) {
    return send("tools", "blocked", `Missing ${missing.join(", ")} from the app bundle — this build is incomplete.`);
  }
  send("tools", "done", "bundled");

  const cli = dockerCli();
  if (!cli) return send("docker", "blocked", "Install Docker Desktop or OrbStack, then press Check again.");
  const version = await dockerReady(cli);
  if (!version) return send("docker", "blocked", "Docker is installed but not running — start it, then press Check again.");
  send("docker", "done", `Docker ${version}`);

  send("database", "running");
  send("database", (await composeUp(cli)) ? "done" : "blocked", "Postgres on port 5433");

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
  startServer();
  const url = `http://localhost:${PORT}`;
  if (!(await waitFor(`${url}/trpc/folders.list`, 120000))) {
    return send("server", "blocked", "The server did not start — check Console.app for pdf2audio.");
  }
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
        { label: "Show data folder", click: () => shell.openPath(path.join(HOME || "", "data")) },
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
