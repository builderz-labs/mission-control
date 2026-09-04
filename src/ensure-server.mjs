import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";

export const HEALTH_URL = "http://127.0.0.1:3000/health";

export function kickstartLabel(uid = userInfo().uid) {
  return `gui/${uid}/com.tylerdevries.mission-control`;
}

export async function isHealthy(url = HEALTH_URL, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return false;
    const body = await response.json();
    if (body.status !== "ok") return false;
    // live-main proxy reports status=ok while next-dev is still compiling.
    if (body.live === false) return false;
    return true;
  } catch {
    return false;
  }
}

export function kickstart(spawn = spawnSync, uid = userInfo().uid) {
  const result = spawn("launchctl", ["kickstart", "-k", kickstartLabel(uid)], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0;
}

export async function ensureServer({
  fetchImpl = fetch,
  spawn = spawnSync,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tries = 40,
} = {}) {
  if (await isHealthy(HEALTH_URL, fetchImpl)) return true;
  kickstart(spawn);
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await wait(200);
    if (await isHealthy(HEALTH_URL, fetchImpl)) return true;
  }
  return false;
}
