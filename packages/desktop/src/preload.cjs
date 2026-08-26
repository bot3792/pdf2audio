const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  onStep: (fn) => ipcRenderer.on("step", (_e, step) => fn(step)),
  recheck: () => ipcRenderer.send("recheck"),
});
