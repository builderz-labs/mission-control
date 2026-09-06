import { setTimeout as wait } from "node:timers/promises";
import { readDesktopCredentials } from "./desktop-auth-store.mjs";

const RETRYABLE = new Set([408, 500, 502, 503, 504]);

async function request(session, url, options, { timeout = 5_000, retryNetwork = true } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await session.fetch(url, { ...options, signal: controller.signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) throw new Error("DESKTOP_LOGIN_REDIRECT_REJECTED");
      if (!RETRYABLE.has(response.status) || attempt === 1) return response;
      await response.arrayBuffer().catch(() => {});
    } catch (error) {
      if (!retryNetwork || attempt === 1 || error.message === "DESKTOP_LOGIN_REDIRECT_REJECTED") throw error;
    } finally { clearTimeout(timer); }
    await wait(150);
  }
  throw new Error("DESKTOP_LOGIN_UNAVAILABLE");
}

export async function loginDesktopSession({ session, origin, checkout }) {
  const { username, password } = await readDesktopCredentials(checkout);
  let response;
  try {
    response = await request(session, `${origin}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "user-agent": "MissionControlDesktop/1.0" },
      body: JSON.stringify({ username, password }),
    }, { timeout: 30_000, retryNetwork: false });
  } catch { throw new Error("DESKTOP_ACCOUNT_LOGIN_UNAVAILABLE"); }
  try { await response.arrayBuffer(); } catch { throw new Error("DESKTOP_ACCOUNT_LOGIN_UNAVAILABLE"); }
  if (!response.ok) throw new Error("DESKTOP_ACCOUNT_LOGIN_FAILED");

  let verification;
  try {
    verification = await request(session, `${origin}/api/auth/me`, {
      method: "GET", credentials: "include", headers: { "user-agent": "MissionControlDesktop/1.0" },
    });
  } catch { throw new Error("DESKTOP_SESSION_VERIFY_FAILED"); }
  try { await verification.arrayBuffer(); } catch { throw new Error("DESKTOP_SESSION_VERIFY_FAILED"); }
  if (!verification.ok) throw new Error("DESKTOP_SESSION_VERIFY_FAILED");
  return true;
}
