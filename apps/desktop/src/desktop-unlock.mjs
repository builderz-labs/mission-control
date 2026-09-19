import { BrowserWindow, ipcMain, systemPreferences } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "./app-paths.mjs";
import { createPinThrottle, verifyPin } from "./desktop-auth-core.mjs";
import { AUTH_FILE_NAME, readAuthConfiguration } from "./desktop-auth-store.mjs";
import { loginDesktopSession } from "./desktop-login.mjs";

const CHANNELS = { status: "mc-auth:status", unlock: "mc-auth:unlock", dismiss: "mc-auth:dismiss" };

export function createDesktopUnlock({ app, origin, backendSession, checkout }) {
  const pinFile = path.join(app.getPath("userData"), AUTH_FILE_NAME);
  const unlockFile = path.join(PACKAGE_ROOT, "src", "unlock.html");
  const preload = path.join(PACKAGE_ROOT, "src", "unlock-preload.cjs");
  const trustedUrl = pathToFileURL(unlockFile).href;
  const throttle = createPinThrottle();
  let unlockWindow;
  let parentWindow;
  let busy = false;

  function touchIdAvailable() {
    try { return process.platform === "darwin" && systemPreferences.canPromptTouchID(); }
    catch { return false; }
  }

  const trusted = (event) => unlockWindow && !unlockWindow.isDestroyed()
    && event.sender === unlockWindow.webContents && event.senderFrame.url === trustedUrl;

  async function status(event) {
    if (!trusted(event)) throw new Error("DESKTOP_AUTH_UNTRUSTED_SENDER");
    const config = await readAuthConfiguration(pinFile);
    return { touchId: touchIdAvailable(), pin: Boolean(config?.pin) };
  }

  async function authenticate(event, input) {
    if (!trusted(event) || busy) return { ok: false, code: "BUSY" };
    busy = true;
    try {
      if (input?.method === "touch-id") {
        if (!touchIdAvailable()) {
          return { ok: false, code: "TOUCH_ID_UNAVAILABLE" };
        }
        try { await systemPreferences.promptTouchID("sign in to Mission Control"); }
        catch { return { ok: false, code: "TOUCH_ID_CANCELLED" }; }
      } else if (input?.method === "pin") {
        const remaining = throttle.remaining();
        if (remaining) return { ok: false, code: "PIN_LOCKED", retryAfter: remaining };
        const config = await readAuthConfiguration(pinFile);
        if (!config?.pin || !await verifyPin(input.pin, config.pin)) {
          return { ok: false, code: "PIN_INVALID", retryAfter: throttle.failure() };
        }
        throttle.success();
      } else return { ok: false, code: "METHOD_INVALID" };

      await loginDesktopSession({ session: backendSession, origin, checkout });
      if (!parentWindow?.isDestroyed()) await parentWindow.loadURL(`${origin}/`);
      if (!unlockWindow?.isDestroyed()) unlockWindow.close();
      return { ok: true };
    } catch (error) {
      const known = new Set(["DESKTOP_ACCOUNT_CREDENTIALS_MISSING", "DESKTOP_ACCOUNT_LOGIN_FAILED",
        "DESKTOP_ACCOUNT_LOGIN_UNAVAILABLE", "DESKTOP_SESSION_VERIFY_FAILED"]);
      return { ok: false, code: known.has(error.message) ? error.message : "DESKTOP_AUTH_FAILED" };
    } finally { busy = false; }
  }

  function dismiss(event) {
    if (!trusted(event)) return false;
    unlockWindow.close();
    return true;
  }

  ipcMain.handle(CHANNELS.status, status);
  ipcMain.handle(CHANNELS.unlock, authenticate);
  ipcMain.handle(CHANNELS.dismiss, dismiss);

  return {
    open(parent) {
      parentWindow = parent;
      if (unlockWindow && !unlockWindow.isDestroyed()) { unlockWindow.focus(); return; }
      unlockWindow = new BrowserWindow({
        parent, modal: true, width: 440, height: 570, resizable: false, maximizable: false,
        fullscreenable: false, show: false, title: "Sign in to Mission Control", backgroundColor: "#09090b",
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, session: backendSession },
      });
      unlockWindow.setMenuBarVisibility(false);
      unlockWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
        unlockWindow.webContents.on(name, (event) => event.preventDefault());
      }
      unlockWindow.once("ready-to-show", () => unlockWindow?.show());
      unlockWindow.on("closed", () => { unlockWindow = undefined; });
      unlockWindow.loadFile(unlockFile).catch(() => unlockWindow?.close());
    },
    close() { if (unlockWindow && !unlockWindow.isDestroyed()) unlockWindow.close(); },
  };
}
