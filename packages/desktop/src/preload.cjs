const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  onSteps: (fn) => ipcRenderer.on("steps", (_e, steps) => fn(steps)),
  onStep: (fn) => ipcRenderer.on("step", (_e, step) => fn(step)),
  recheck: () => ipcRenderer.send("recheck"),
});
