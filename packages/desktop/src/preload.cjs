const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  onSteps: (fn) => ipcRenderer.on("steps", (_e, steps) => fn(steps)),
  onStep: (fn) => ipcRenderer.on("step", (_e, step) => fn(step)),
  recheck: () => ipcRenderer.send("recheck"),
  onFailed: (fn) => ipcRenderer.on("failed", (_e, info) => fn(info)),
  onHelp: (fn) => ipcRenderer.on("help", (_e, help) => fn(help)),
  open: (url) => ipcRenderer.send("open", url),
  report: () => ipcRenderer.send("report"),
});
