import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { PACKAGE_ROOT } from "./app-paths.mjs";
import { openBackend, partitionForOrigin } from "./backend-window.mjs";
import { validateOrigin } from "./origin.mjs";
import { configurePermissions, focusOrCreateWindow, secureWindow } from "./window-policy.mjs";

app.setName("Mission Control");
const locked = app.requestSingleInstanceLock();
let window;
let origin;
let backendSession;
const failedWindows = new WeakSet();

function showLoadError(target) {
  if (target.isDestroyed() || failedWindows.has(target)) return;
  failedWindows.add(target);
  target.loadFile(path.join(PACKAGE_ROOT, "src", "error.html")).catch(() => {
    console.error("[desktop] shell_load_failed");
  });
  target.show();
}

async function attachWindow(target) {
  try {
    if (!origin || !await openBackend({ origin, loadURL: async (url) => {
      if (!target.isDestroyed()) await target.loadURL(url);
    } })) showLoadError(target);
  } catch {
    console.error("[desktop] backend_attach_failed");
    showLoadError(target);
  }
}

function createWindow() {
  const target = new BrowserWindow({
    width: 1280, height: 840, title: "Mission Control", backgroundColor: "#09090b",
    show: true, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: backendSession },
  });
  window = target;
  secureWindow(target.webContents, origin);
  target.webContents.on("did-fail-load", (_event, code, _description, _url, isMain) => {
    if (isMain && code !== -3) showLoadError(target);
  });
  target.loadFile(path.join(PACKAGE_ROOT, "src", "shell.html"))
    .then(() => attachWindow(target)).catch(() => showLoadError(target));
  return target;
}

if (!locked) {
  app.quit();
} else {
  app.on("second-instance", () => {
    app.whenReady().then(() => { window = focusOrCreateWindow(window, createWindow); })
      .catch(() => console.error("[desktop] window_reopen_failed"));
  });
  app.whenReady().then(() => {
    try { origin = validateOrigin(process.env.MC_DESKTOP_URL); }
    catch { console.error("[desktop] invalid_backend_origin"); }
    // No persist: prefix: credentials live only for this app process and full origin.
    backendSession = session.fromPartition(origin ? partitionForOrigin(origin) : "mc-invalid-config");
    configurePermissions(backendSession, origin);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch(() => { console.error("[desktop] startup_failed"); app.quit(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
