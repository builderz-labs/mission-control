import { createRequire } from "node:module";
import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ELECTRON_VERSION } from "./package-inputs.mjs";

export async function resolveElectron(root, { override, stageOnly = false } = {}) {
  if (override && !stageOnly) throw new Error("ELECTRON_OVERRIDE_STAGE_ONLY");
  const require = createRequire(path.join(root, "package.json"));
  let directory;
  try {
    directory = await realpath(override ?? path.dirname(require.resolve("electron/package.json")));
  } catch { throw new Error("ELECTRON_MISSING_RUN_PNPM_INSTALL"); }
  const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const version = (await readFile(path.join(directory, "dist/version"), "utf8")).trim();
  if (metadata.name !== "electron" || metadata.version !== ELECTRON_VERSION || version !== ELECTRON_VERSION) {
    throw new Error("ELECTRON_VERSION_MISMATCH");
  }
  const bundle = path.join(directory, "dist/Electron.app");
  await access(path.join(bundle, "Contents/MacOS/Electron"), constants.X_OK);
  return bundle;
}
