import { readFile } from "node:fs/promises";
import { parseEnv } from "./env-file.mjs";
import { envPath } from "./app-paths.mjs";
import { DEFAULT_ORIGIN, validateOrigin } from "./origin.mjs";
import { healthStatus } from "./ensure-server.mjs";
import { request } from "./network.mjs";

export function parseSessionCookie(headers) {
  for (const header of Array.isArray(headers) ? headers : [headers]) {
    if (typeof header !== "string") continue;
    const match = header.match(/^(mc-session|__Host-mc-session)=([^;\s]+)(?:;|$)/);
    if (!match) continue;
    const secure = /;\s*Secure(?:;|$)/i.test(header);
    if (match[1].startsWith("__Host-") && !secure) continue;
    if (/;\s*Domain=/i.test(header) || !/;\s*Path=\/(?:;|$)/i.test(header)) continue;
    const cookie = { name: match[1], value: match[2], path: "/", secure,
      httpOnly: true, sameSite: "strict" };
    const maxAge = header.match(/;\s*Max-Age=(\d+)(?:;|$)/i);
    if (maxAge) cookie.expirationDate = Math.floor(Date.now() / 1000) + Number(maxAge[1]);
    return cookie;
  }
  return null;
}

export async function readLocalAuth(filePath, read = readFile) {
  try {
    const env = parseEnv(await read(filePath, "utf8"));
    const password = env.AUTH_PASS_B64
      ? Buffer.from(env.AUTH_PASS_B64, "base64").toString("utf8") : env.AUTH_PASS;
    if (!env.AUTH_USER || !password) return null;
    return { username: env.AUTH_USER, password };
  } catch { return null; }
}

export async function loginSession({
  origin = DEFAULT_ORIGIN, filePath, read = readFile, ...network
} = {}) {
  const selected = validateOrigin(origin); // Always before resolving or reading secrets.
  const url = `${selected}/api/auth/login`;
  // Credential-free probes reject redirecting origins/endpoints before opening .env.
  if (await healthStatus(selected, network) !== "healthy") return null;
  try {
    const ready = await request(url, {
      ...network, method: "GET", consume: async (response) => response.ok || response.status === 405,
    });
    if (!ready) return null;
    const creds = await readLocalAuth(filePath ?? envPath(), read);
    if (!creds) return null;
    return await request(url, {
      ...network, method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
      consume: async (response) => response.ok
        ? parseSessionCookie(response.headers.getSetCookie()) : null,
    });
  } catch { return null; }
}

export async function applySessionCookie(cookies, cookie, origin) {
  const selected = validateOrigin(origin);
  if (!cookie) return false;
  try {
    await cookies.set({ ...cookie, url: selected });
    return true;
  } catch { return false; } // Never weaken Secure or retry with downgraded attributes.
}
