import { app, BrowserWindow, session } from "electron";
import { loginSession } from "./auto-login.mjs";
import { ensureServer, isHealthy } from "./ensure-server.mjs";

const APP_URL = "http://127.0.0.1:3000";
app.setName("Mission Control");
app.commandLine.appendSwitch("disable-http-cache");

async function applySessionCookie(cookie) {
  if (!cookie) return;
  const details = {
    url: APP_URL,
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

async function createWindow(ok) {
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
  dismissOnboarding(window);
  followLiveMain(window);
  if (ok) {
    await applySessionCookie(await loginSession());
    window.loadURL(APP_URL);
    return;
  }
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
    "<h1>Mission Control is offline</h1><p>Heal could not reach http://127.0.0.1:3000/health.</p>",
  )}`);
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
