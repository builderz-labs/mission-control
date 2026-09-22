import { lstat, mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createPinRecord, credentialsFromEnvironment, parseEnvironment } from "./desktop-auth-core.mjs";

export const AUTH_FILE_NAME = "desktop-auth.json";

async function regularFile(file) {
  try {
    const stat = await lstat(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

export async function readAuthConfiguration(file) {
  if (!await regularFile(file)) return null;
  try {
    const source = await readFile(file, { encoding: "utf8", flag: "r" });
    if (Buffer.byteLength(source) > 16_384) throw new Error("DESKTOP_AUTH_CONFIG_INVALID");
    const config = JSON.parse(source);
    return config?.version === 1 && config.pin ? config : null;
  } catch (error) {
    if (error.message === "DESKTOP_AUTH_CONFIG_INVALID") throw error;
    throw new Error("DESKTOP_AUTH_CONFIG_INVALID");
  }
}

export async function writePinConfiguration(file, pin) {
  if (!path.isAbsolute(file)) throw new Error("DESKTOP_AUTH_PATH_INVALID");
  const config = { version: 1, pin: await createPinRecord(pin), updatedAt: new Date().toISOString() };
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(config)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return file;
}

export async function readDesktopCredentials(checkout) {
  if (!path.isAbsolute(checkout)) throw new Error("DESKTOP_ROOT_INVALID");
  const file = path.join(checkout, ".env");
  if (!await regularFile(file)) throw new Error("DESKTOP_ACCOUNT_CREDENTIALS_MISSING");
  const source = await readFile(file, "utf8");
  if (Buffer.byteLength(source) > 128 * 1024) throw new Error("DESKTOP_ACCOUNT_CREDENTIALS_INVALID");
  try { return credentialsFromEnvironment(parseEnvironment(source)); }
  catch { throw new Error("DESKTOP_ACCOUNT_CREDENTIALS_MISSING"); }
}
