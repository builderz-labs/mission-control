import { app, BrowserWindow, session } from "electron";
import { loginSession } from "./auto-login.mjs";
import { ensureServer, isHealthy } from "./ensure-server.mjs";

const APP_URL = "http://127.0.0.1:3000/";
const BG = "#09090b";
app.setName("Mission Control");
app.commandLine.appendSwitch("disable-http-cache");

async function applySessionCookie(cookie) {
  if (!cookie) return;
  const details = {
    url: "http://127.0.0.1:3000",
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

function followLiveMain(window) {
  let live = true;
  setInterval(async () => {
    const ok = await isHealthy();
    if (ok && !live) window.webContents.reloadIgnoringCache();
    live = ok;
  }, 1500);
}

function showLoadError(window, detail) {
  const html = `<!doctype html><html style="background:${BG};color:#fafafa"><body style="font:14px system-ui;padding:32px"><h1>Mission Control failed to load</h1><p>${detail}</p></body></html>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!window.isVisible()) window.show();
}

async function createWindow(ok) {
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
  followLiveMain(window);
  if (!ok) {
    showLoadError(window, "Heal could not reach http://127.0.0.1:3000/health.");
    return;
  }
  await applySessionCookie(await loginSession());
  window.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  const ok = await ensureServer();
  await createWindow(ok);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ok);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
