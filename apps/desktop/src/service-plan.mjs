import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ORIGIN, validateOrigin } from "./origin.mjs";

export const LAUNCH_AGENTS = path.join(os.homedir(), "Library/LaunchAgents");

export function portFromArguments(args) {
  if (!Array.isArray(args)) return NaN;
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index]);
    if (value === "--port") return Number(args[index + 1]);
    if (value.startsWith("--port=")) return Number(value.slice("--port=".length));
  }
  return NaN;
}

// Every server the desktop app is responsible for starting. `port` reads the
// authoritative value out of the service's own launchd plist, so moving a
// service to another port needs no rebuild of the app bundle. `required` marks
// the one server the window itself loads; the rest start alongside it.
export const SERVICES = [
  {
    key: "backend",
    label: "com.tylerdevries.mission-control",
    defaultPort: 3000,
    required: true,
    port: (plist) => Number(plist?.EnvironmentVariables?.PORT),
    accepts: (body) => body?.status === "ok" && body.live !== false,
  },
  {
    key: "gateway",
    label: "ai.openclaw.gateway",
    defaultPort: 18789,
    required: false,
    port: (plist) => portFromArguments(plist?.ProgramArguments),
    accepts: (body) => body?.ok === true || body?.status === "live",
  },
];

export function originForPort(port, defaultPort) {
  for (const candidate of [port, defaultPort]) {
    try { return validateOrigin(`http://127.0.0.1:${candidate}`); } catch { /* try the next */ }
  }
  return DEFAULT_ORIGIN;
}

// Parse only; never execute the plist. A missing or malformed file yields null
// so the caller falls back to the compiled-in default port.
export function readPlist(file, run = execFile) {
  return new Promise((resolve) => {
    try {
      run("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], {
        timeout: 10_000, maxBuffer: 262_144, encoding: "utf8",
      }, (error, stdout) => {
        if (error) return resolve(null);
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      });
    } catch { resolve(null); }
  });
}

export async function planServices({
  run = execFile, agents = LAUNCH_AGENTS, env = process.env, services = SERVICES,
} = {}) {
  return Promise.all(services.map(async (service) => {
    const plist = path.join(agents, `${service.label}.plist`);
    const override = service.required ? env.MC_DESKTOP_URL : undefined;
    // An explicit override is honoured exactly or rejected; never widened.
    if (override !== undefined) return { ...service, plist, origin: validateOrigin(override) };
    const port = service.port(await readPlist(plist, run));
    return { ...service, plist, origin: originForPort(port, service.defaultPort) };
  }));
}

export function backendOf(plan) {
  return plan.find((service) => service.required) ?? null;
}
