import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { DEFAULT_ORIGIN, validateOrigin } from "./origin.mjs";
import { delay, request } from "./network.mjs";

export function kickstartLabel(uid = userInfo().uid) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error("DESKTOP_USER_INVALID");
  return `gui/${uid}/com.tylerdevries.mission-control`;
}

export async function healthStatus(origin = DEFAULT_ORIGIN, options = {}) {
  const selected = validateOrigin(origin);
  try {
    return await request(`${selected}/health`, {
      ...options,
      consume: async (response) => {
        if (!response.ok) return "unavailable";
        const body = await response.json();
        return body?.status === "ok" && body.live !== false ? "healthy" : "unavailable";
      },
    });
  } catch (error) {
    return error.code === "DESKTOP_REDIRECT_REJECTED" ? "redirect" : "unavailable";
  }
}

export function kickstart(run = execFile, uid = userInfo().uid) {
  return new Promise((resolve) => {
    try {
      run("/bin/launchctl", ["kickstart", kickstartLabel(uid)], {
        timeout: 10_000, maxBuffer: 4096, encoding: "utf8",
      }, (error) => resolve(!error));
    } catch { resolve(false); }
  });
}

export async function ensureServer({
  origin = DEFAULT_ORIGIN, run = execFile, wait = delay, tries = 20, ...network
} = {}) {
  const selected = validateOrigin(origin);
  let state = await healthStatus(selected, { ...network, wait });
  if (state === "healthy") return true;
  if (state === "redirect" || selected !== DEFAULT_ORIGIN) return false;
  // No -k: an existing shared service is never stopped or force-restarted.
  if (!await kickstart(run)) return false;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await wait(250);
    state = await healthStatus(selected, { ...network, wait });
    if (state === "healthy") return true;
    if (state === "redirect") return false;
  }
  return false;
}
