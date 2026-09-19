import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { validateOrigin } from "./origin.mjs";
import { delay, request } from "./network.mjs";
import { backendOf, planServices } from "./service-plan.mjs";

const LIVE = (body) => body?.status === "ok" && body.live !== false;

export function serviceTarget(label, uid = userInfo().uid) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error("DESKTOP_USER_INVALID");
  if (typeof label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(label)) {
    throw new Error("DESKTOP_LABEL_INVALID");
  }
  return `gui/${uid}/${label}`;
}

export async function healthStatus(origin, { accepts = LIVE, ...options } = {}) {
  const selected = validateOrigin(origin);
  try {
    return await request(`${selected}/health`, {
      ...options,
      consume: async (response) => {
        if (!response.ok) return "unavailable";
        return accepts(await response.json()) ? "healthy" : "unavailable";
      },
    });
  } catch (error) {
    return error.code === "DESKTOP_REDIRECT_REJECTED" ? "redirect" : "unavailable";
  }
}

export function launchctl(args, run = execFile) {
  return new Promise((resolve) => {
    try {
      run("/bin/launchctl", args, {
        timeout: 10_000, maxBuffer: 4096, encoding: "utf8",
      }, (error) => resolve(!error));
    } catch { resolve(false); }
  });
}

export async function startService(service, { run = execFile, uid = userInfo().uid } = {}) {
  const target = serviceTarget(service?.label, uid);
  // `enable` only clears a previous `launchctl disable`; on its own it starts nothing.
  await launchctl(["enable", target], run);
  // No -k: an already running shared service is never stopped or force-restarted.
  if (await launchctl(["kickstart", target], run)) return true;
  // Never bootstrapped into this GUI domain: load it from its own plist, then start.
  if (typeof service.plist !== "string" || service.plist.length === 0) return false;
  if (!await launchctl(["bootstrap", `gui/${uid}`, service.plist], run)) return false;
  return launchctl(["kickstart", target], run);
}

export async function ensureService(service, {
  run = execFile, wait = delay, tries = 20, uid, ...network
} = {}) {
  const selected = validateOrigin(service?.origin);
  const probe = () => healthStatus(selected, { ...network, wait, accepts: service.accepts ?? LIVE });
  let state = await probe();
  if (state === "healthy") return true;
  if (state === "redirect") return false;
  if (!await startService(service, { run, uid })) return false;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await wait(250);
    state = await probe();
    if (state === "healthy") return true;
    if (state === "redirect") return false;
  }
  return false;
}

// Starts every planned server at once and reports each by key. Nothing here
// waits on one service to settle before starting the next.
export function ensureServices(plan, options = {}) {
  return new Map(plan.map((service) => [service.key, ensureService(service, options)]));
}

export async function ensureServer({ origin, plan, log = console.error, ...options } = {}) {
  const services = plan ?? await planServices();
  const backend = backendOf(services);
  if (!backend) return false;
  // A caller-supplied origin must be the planned backend; never start servers for a foreign one.
  if (origin !== undefined && validateOrigin(origin) !== validateOrigin(backend.origin)) return false;
  const results = ensureServices(services, options);
  for (const [key, started] of results) {
    if (key === backend.key) continue;
    started.then((ok) => { if (!ok) log(`[desktop] service_unavailable ${key}`); })
      .catch(() => log(`[desktop] service_failed ${key}`));
  }
  return results.get(backend.key);
}
