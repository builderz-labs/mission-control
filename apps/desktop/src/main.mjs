import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginSession } from "./auto-login.mjs";
import {
  hasBundledServer,
  startBundledServer,
  stopBundledServer,
} from "./bundled-server.mjs";
import { ensureServer } from "./ensure-server.mjs";

const BG = "#09090b";
const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHELL = path.join(APP_ROOT, "src", "shell.html");
app.setName("Mission Control");
app.commandLine.appendSwitch("disable-http-cache");

let serverChild = null;

async function applySessionCookie(cookie, origin) {
  if (!cookie) return;
  const details = {
    url: origin,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    httpOnly: true,
    sameSite: "strict",
    secure: Boolean(cookie.secure),
  };
  try {
    await session.defaultSession.cookies.set(details);
  } catch {
    details.secure = false;
    await session.defaultSession.cookies.set(details);
  }
}

function dismissOnboarding(window) {
  window.webContents.on("dom-ready", () => {
    window.webContents.executeJavaScript(
      "sessionStorage.setItem('mc-onboarding-dismissed','1')",
    ).catch(() => {});
  });
}

function showLoadError(window, detail) {
  const html = `<!doctype html><html style="background:${BG};color:#fafafa"><body style="font:14px system-ui;padding:32px"><h1>Mission Control failed to load</h1><p>${detail}</p></body></html>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!window.isVisible()) window.show();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "Mission Control",
    backgroundColor: BG,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("did-fail-load", (_event, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    showLoadError(window, `${desc} (${code}) ${url}`);
  });
  dismissOnboarding(window);
  window.loadFile(SHELL);
  return window;
}

async function resolveOrigin() {
  const override = process.env.MC_DESKTOP_URL;
  if (override) {
    const ok = await ensureServer();
    if (!ok) return null;
    return override.replace(/\/$/, "");
  }
  if (hasBundledServer(APP_ROOT)) {
    const started = await startBundledServer({ appRoot: APP_ROOT });
    serverChild = started.child;
    return started.origin;
  }
  const ok = await ensureServer();
  return ok ? "http://127.0.0.1:3000" : null;
}

async function attachWindow(window) {
  try {
    const origin = await resolveOrigin();
    if (!origin) {
      showLoadError(window, "Could not start the bundled Mission Control server.");
      return;
    }
    await applySessionCookie(
      await loginSession({ url: `${origin}/api/auth/login` }),
      origin,
    );
    window.loadURL(`${origin}/`);
  } catch (error) {
    showLoadError(window, error instanceof Error ? error.message : String(error));
  }
}

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  const window = createWindow();
  await attachWindow(window);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createWindow();
      attachWindow(next);
    }
  });
});

app.on("before-quit", () => {
  stopBundledServer(serverChild);
  serverChild = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
