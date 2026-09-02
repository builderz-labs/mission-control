import os from "node:os";
import path from "node:path";

export const ELECTRON_RELPATH = "Electron.app/Contents/MacOS/Electron";

export function desktopRoot(home = os.homedir()) {
  return path.join(home, "Dev", "mission-control-desktop");
}

export function appBundle(home = os.homedir()) {
  return path.join(home, "Applications", "Mission Control.app");
}

export function electronBinary(root) {
  return path.join(root, "node_modules", "electron", "dist", ELECTRON_RELPATH);
}

export function pathTxtContents() {
  return ELECTRON_RELPATH;
}
