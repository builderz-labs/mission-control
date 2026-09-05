import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "./env-file.mjs";

export const LOGIN_URL = "http://127.0.0.1:3000/api/auth/login";

export function envPath(home = os.homedir()) {
  return path.join(home, "Dev", "mission-control", ".env");
}

export function parseSessionCookie(setCookie) {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of headers) {
    if (!header) continue;
    const text = String(header);
    const match = text.match(/^(mc-session|__Host-mc-session)=([^;]+)/i);
    if (!match) continue;
    return {
      name: match[1],
      value: match[2],
      path: "/",
      secure: /(?:^|;)\s*Secure\b/i.test(text),
    };
  }
  return null;
}

export async function readLocalAuth(filePath) {
  try {
    const env = parseEnv(await readFile(filePath, "utf8"));
    if (!env.AUTH_USER || !env.AUTH_PASS) return null;
    return { username: env.AUTH_USER, password: env.AUTH_PASS };
  } catch {
    return null;
  }
}

export async function loginSession({
  filePath = envPath(),
  fetchImpl = fetch,
  url = LOGIN_URL,
} = {}) {
  const creds = await readLocalAuth(filePath);
  if (!creds) return null;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const header = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
    return parseSessionCookie(header);
  } catch {
    return null;
  }
}
