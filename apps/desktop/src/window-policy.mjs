import { allowsNavigation } from "./origin.mjs";

export function configurePermissions(session, origin) {
  const allowed = (contents, permission, requestingUrl) => permission === "clipboard-sanitized-write"
    && Boolean(contents) && allowsNavigation(contents.getURL(), origin)
    && allowsNavigation(requestingUrl, origin);
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed(contents, permission, details.requestingUrl));
  });
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return allowed(contents, permission, requestingOrigin);
  });
}

export function focusOrCreateWindow(window, create) {
  if (!window || window.isDestroyed()) return create();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

export function isSafeExternalUrl(target, origin) {
  try {
    const url = new URL(target);
    return url.protocol === "https:" && !url.username && !url.password
      && !allowsNavigation(url.href, origin);
  } catch { return false; }
}

export function secureWindow(webContents, origin, openExternal = () => {}) {
  webContents.setWindowOpenHandler(({ url } = {}) => {
    if (isSafeExternalUrl(url, origin)) {
      Promise.resolve(openExternal(url)).catch(() => {
        console.error("[desktop] external_link_failed");
      });
    }
    return { action: "deny" };
  });
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
    webContents.on(name, (event, url) => {
      if (!allowsNavigation(url ?? event.url, origin)) event.preventDefault();
    });
  }
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}
