const { app, dialog } = require("electron");

// Checked in the background after the window is up, never during boot: an update that delays the
// app opening is worse than an update that waits for the next launch. The runtime steps
// (runtime.cjs) then bring Python and the models forward on that next launch, which is why a
// restart is offered rather than a silent swap.
function install({ onStatus } = {}) {
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return; // not packaged with an updater, e.g. a dev run
  }

  // We ship the DMG and let people decide; a background download that then demands a restart is
  // the behaviour everyone complains about.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", async (info) => {
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
  });

  autoUpdater.on("update-downloaded", async (info) => {
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

  // A failed check must never reach the user: they did not ask, and there is nothing to do about it
  autoUpdater.on("error", (err) => onStatus?.(`Update check failed: ${err.message}`));

  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { install };
