import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { PACKAGE_ROOT } from "./app-paths.mjs";
import { applySessionCookie, loginSession } from "./auto-login.mjs";
import { ensureServer } from "./ensure-server.mjs";
import { validateOrigin } from "./origin.mjs";
import { secureWindow } from "./window-policy.mjs";

app.setName("Mission Control");
const locked = app.requestSingleInstanceLock();
let window;
let origin;
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
    if (!origin || !await ensureServer({ origin })) { showLoadError(target); return; }
    const cookie = await loginSession({ origin });
    const authenticated = await applySessionCookie(session.defaultSession.cookies, cookie, origin);
    if (!target.isDestroyed()) await target.loadURL(`${origin}/${authenticated ? "" : "login"}`);
  } catch {
    console.error("[desktop] backend_attach_failed");
    showLoadError(target);
  }
}

function createWindow() {
  const target = new BrowserWindow({
    width: 1280, height: 840, title: "Mission Control", backgroundColor: "#09090b",
    show: true, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window = target;
  secureWindow(target.webContents, origin);
  target.webContents.on("will-redirect", () => showLoadError(target));
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
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.whenReady().then(() => {
    try { origin = validateOrigin(process.env.MC_DESKTOP_URL); }
    catch { console.error("[desktop] invalid_backend_origin"); }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch(() => { console.error("[desktop] startup_failed"); app.quit(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
