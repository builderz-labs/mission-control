import { allowsNavigation } from "./origin.mjs";

export function secureWindow(webContents, origin) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
    webContents.on(name, (event, url) => {
      if (!allowsNavigation(url ?? event.url, origin)) event.preventDefault();
    });
  }
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}
