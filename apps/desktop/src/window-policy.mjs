import { allowsNavigation } from "./origin.mjs";

export function secureWindow(webContents, origin) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of ["will-navigate", "will-frame-navigate"]) {
    webContents.on(name, (event, url) => {
      if (!allowsNavigation(url ?? event.url, origin)) event.preventDefault();
    });
  }
  // All navigation redirects are refused, including those within the origin.
  webContents.on("will-redirect", (event) => event.preventDefault());
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}
