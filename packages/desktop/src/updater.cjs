const { app, dialog, shell } = require("electron");

// Checked in the background after the window is up, never during boot: an update that delays the
// app opening is worse than an update that waits for the next launch. The runtime steps
// (runtime.cjs) then bring Python and the models forward on that next launch, which is why a
// restart is offered rather than a silent swap.
//
// Nothing is pushed to us — every check is a GET of latest-mac.yml. Once per launch is not enough
// for an app people leave open for days at a time, so it also repeats; declining a version stops
// it asking about that version again until the app restarts.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
function install({ onStatus } = {}) {
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return; // not packaged with an updater, e.g. a dev run
  }

  // electron-updater's own account of what it decided, which is the only way to tell "no update"
  // apart from "could not reach the feed" apart from "refused the signature".
  autoUpdater.logger = { info: onStatus ?? (() => {}), warn: onStatus ?? (() => {}), error: onStatus ?? (() => {}), debug: () => {} };

  // We ship the DMG and let people decide; a background download that then demands a restart is
  // the behaviour everyone complains about.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  let downloaded = null;
  const declined = new Set();

  autoUpdater.on("update-available", async (info) => {
    if (declined.has(info.version)) return;
    onStatus?.(`Update available: ${info.version}`);
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "A new pdf2audio is available",
      message: `Version ${info.version} is ready to download.`,
      detail: "It installs when you quit, and the next launch brings the Python environment and models up to date with it. Nothing in your library changes.",
      buttons: ["Download it", "Not now"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) await autoUpdater.downloadUpdate();
    else declined.add(info.version);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    downloaded = info.version;
    onStatus?.(`Update ${info.version} downloaded`);
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Ready to install",
      message: `pdf2audio ${info.version} is ready.`,
      detail: "Restarting takes a few seconds. If this release changes the Python environment, the next launch will say so while it catches up.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      // The server child is killed by before-quit; quitAndInstall runs after that
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    onStatus?.(`Updater error: ${err.message}`);
    // A failed *check* must never reach the user: they did not ask, and there is nothing to do
    // about it. A failed *install* is different — they clicked twice and are waiting for a restart
    // that will not come, and the manual download does work.
    if (!downloaded) return;
    const signature = /code signature|did not pass validation/i.test(err.message);
    void dialog.showMessageBox({
      type: "warning",
      title: "That update could not install itself",
      message: `pdf2audio ${downloaded} downloaded, but macOS would not let it replace the running app.`,
      detail: signature
        ? "This build is not signed by an Apple developer certificate, and macOS only lets signed apps update themselves. Downloading the new version and dragging it to Applications works — it is the same file."
        : err.message,
      buttons: ["Open the downloads page", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) void shell.openExternal("https://github.com/subev/pdf2audio/releases/latest");
    });
  });

  if (!app.isPackaged) return;
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  app.on("before-quit", () => clearInterval(timer));
}

module.exports = { install };
