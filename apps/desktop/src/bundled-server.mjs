import { spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "./env-file.mjs";
import { isHealthy } from "./ensure-server.mjs";

export const BUNDLED_PORT = 18791;

export function serverDir(appRoot) {
  return path.join(appRoot, "server");
}

export function runtimeNode(appRoot) {
  return path.join(appRoot, "runtime", "node");
}

export function bundledOrigin(port = BUNDLED_PORT) {
  return `http://127.0.0.1:${Number(port)}`;
}

export function hasBundledServer(appRoot) {
  return existsSync(path.join(serverDir(appRoot), "server.js"));
}

export function resolveNode(appRoot, env = process.env) {
  if (env.MC_NODE_BIN) return env.MC_NODE_BIN;
  const bundled = runtimeNode(appRoot);
  if (existsSync(bundled)) return bundled;
  return "node";
}

export function dataDir(home = os.homedir()) {
  const dev = path.join(home, "Dev", "mission-control", ".data");
  if (existsSync(dev)) return dev;
  return path.join(
    home,
    "Library",
    "Application Support",
    "Mission Control",
    "data",
  );
}

export function envFile(home = os.homedir()) {
  const dev = path.join(home, "Dev", "mission-control", ".env");
  if (existsSync(dev)) return dev;
  return path.join(
    home,
    "Library",
    "Application Support",
    "Mission Control",
    ".env",
  );
}

export function nodePath(env = process.env, home = os.homedir()) {
  return [
    path.join(home, ".nvm", "versions", "node", "v24.16.0", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    env.PATH || "",
  ].filter(Boolean).join(":");
}

export function spawnEnv({
  port = BUNDLED_PORT,
  dataDirectory,
  fileEnv = {},
  env = process.env,
  home = os.homedir(),
} = {}) {
  return {
    ...env,
    ...fileEnv,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    MISSION_CONTROL_DATA_DIR: dataDirectory,
    MC_COOKIE_SECURE: "0",
    MC_DISABLE_HSTS: "1",
    NODE_ENV: "production",
    PATH: nodePath(env, home),
  };
}

export function isCompileSplash(html) {
  const text = String(html);
  return text.includes("Loading Mission Control") && !text.includes("/_next/");
}

export async function waitHealthy(url, {
  fetchImpl = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tries = 50,
} = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await isHealthy(url, fetchImpl)) return true;
    await wait(100);
  }
  return false;
}

async function readFileEnv(filePath, read = readFile) {
  if (!existsSync(filePath)) return {};
  try {
    return parseEnv(await read(filePath, "utf8"));
  } catch {
    return {};
  }
}

export async function startBundledServer({
  appRoot,
  port = Number(process.env.MC_DESKTOP_PORT || BUNDLED_PORT),
  home = os.homedir(),
  spawn = spawnChild,
  fetchImpl = fetch,
  wait,
  read = readFile,
} = {}) {
  const origin = bundledOrigin(port);
  const health = `${origin}/health`;
  if (await isHealthy(health, fetchImpl)) {
    return { origin, child: null, reused: true };
  }
  if (!hasBundledServer(appRoot)) {
    throw new Error("bundled Next server is missing from the app");
  }
  const child = spawn(resolveNode(appRoot), ["server.js"], {
    cwd: serverDir(appRoot),
    env: spawnEnv({
      port,
      dataDirectory: dataDir(home),
      fileEnv: await readFileEnv(envFile(home), read),
      home,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ok = await waitHealthy(health, { fetchImpl, wait, tries: 50 });
  if (!ok) {
    stopBundledServer(child);
    throw new Error(`bundled server failed health at ${health}`);
  }
  return { origin, child, reused: false };
}

export function stopBundledServer(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // already exited
  }
}
