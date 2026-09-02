import { app, BrowserWindow } from "electron";
import { ensureServer } from "./ensure-server.mjs";

const APP_URL = "http://127.0.0.1:3000";

function createWindow(ok) {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "Mission Control",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (ok) {
    window.loadURL(APP_URL);
    return;
  }
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
    "<h1>Mission Control is offline</h1><p>Heal could not reach http://127.0.0.1:3000/health.</p>",
  )}`);
}

app.whenReady().then(async () => {
  const ok = await ensureServer();
  createWindow(ok);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ok);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
