import assert from "node:assert/strict";
import test from "node:test";
import { fixture, put } from "../tests/fixtures.mjs";
import { loginDesktopSession } from "./desktop-login.mjs";

function response(status = 200) {
  return { status, ok: status >= 200 && status < 300, arrayBuffer: async () => new ArrayBuffer(0) };
}

test("desktop login uses the selected session and verifies its backend cookie", async (t) => {
  const root = await fixture(t);
  await put(root, ".env", "AUTH_USER=pilot\nAUTH_PASS=secret-value\n");
  const calls = [];
  const session = { fetch: async (url, options) => { calls.push({ url, options }); return response(); } };
  assert.equal(await loginDesktopSession({ session, origin: "http://127.0.0.1:3000", checkout: root }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.endsWith("/api/auth/login"), true);
  assert.equal(JSON.parse(calls[0].options.body).username, "pilot");
  assert.equal(calls[1].url.endsWith("/api/auth/me"), true);
  assert.equal(calls.every(({ options }) => options.credentials === "include"), true);
});

test("desktop login retries transient responses and rejects auth failures", async (t) => {
  const root = await fixture(t);
  await put(root, ".env", "AUTH_PASS=secret-value\n");
  let calls = 0;
  const retrying = { fetch: async () => response(++calls === 1 ? 503 : 200) };
  assert.equal(await loginDesktopSession({ session: retrying, origin: "http://127.0.0.1:3000", checkout: root }), true);
  assert.equal(calls, 3);
  await assert.rejects(loginDesktopSession({ session: { fetch: async () => response(401) },
    origin: "http://127.0.0.1:3000", checkout: root }), /LOGIN_FAILED/);
});

test("desktop login refuses redirects and sessions that cannot be verified", async (t) => {
  const root = await fixture(t);
  await put(root, ".env", "AUTH_PASS=secret-value\n");
  await assert.rejects(loginDesktopSession({ session: { fetch: async () => response(302) },
    origin: "http://127.0.0.1:3000", checkout: root }), /LOGIN_UNAVAILABLE/);
  let call = 0;
  await assert.rejects(loginDesktopSession({ session: { fetch: async () => response(++call === 1 ? 200 : 401) },
    origin: "http://127.0.0.1:3000", checkout: root }), /VERIFY_FAILED/);
});
