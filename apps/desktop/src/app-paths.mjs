import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function discoverRoot(start = PACKAGE_ROOT) {
  let directory = path.resolve(start);
  while (true) {
    if (existsSync(path.join(directory, "apps/desktop/package.json"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function canonicalRoot(root) {
  const git = path.join(root, ".git");
  try {
    const match = readFileSync(git, "utf8").trim().match(/^gitdir: (.+)$/);
    if (!match) return root;
    const gitDir = path.resolve(root, match[1]);
    const common = readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    return path.dirname(path.resolve(gitDir, common));
  } catch { return root; }
}

export function checkoutRoot({ env = process.env, start = PACKAGE_ROOT, home = os.homedir() } = {}) {
  if (env.MISSION_CONTROL_ROOT !== undefined) {
    if (!path.isAbsolute(env.MISSION_CONTROL_ROOT)) throw new Error("DESKTOP_ROOT_INVALID");
    return realpathSync(env.MISSION_CONTROL_ROOT);
  }
  const discovered = discoverRoot(start);
  if (discovered) return canonicalRoot(discovered);
  try {
    const config = JSON.parse(readFileSync(path.join(start, "desktop-config.json"), "utf8"));
    if (path.isAbsolute(config.checkoutRoot)) return config.checkoutRoot;
  } catch { /* Unpackaged development fallback. No credentials are read here. */ }
  return path.join(home, "Dev", "mission-control");
}

export function envPath(options = {}) {
  const env = options.env ?? process.env;
  if (env.MC_DESKTOP_ENV_FILE !== undefined) {
    if (!path.isAbsolute(env.MC_DESKTOP_ENV_FILE)) throw new Error("DESKTOP_ENV_PATH_INVALID");
    return env.MC_DESKTOP_ENV_FILE;
  }
  return path.join(checkoutRoot(options), ".env");
}
