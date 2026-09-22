const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("missionControlAuth", Object.freeze({
  status: () => ipcRenderer.invoke("mc-auth:status"),
  unlock: (method, pin) => ipcRenderer.invoke("mc-auth:unlock", { method, pin }),
  dismiss: () => ipcRenderer.invoke("mc-auth:dismiss"),
}));
