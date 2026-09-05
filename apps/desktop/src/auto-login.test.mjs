import assert from "node:assert/strict";
import test from "node:test";
import { loginSession, readLocalAuth, parseSessionCookie, applySessionCookie } from "./auto-login.mjs";
import { parseEnv } from "./env-file.mjs";
import { fixture, put, response, noWait } from "../tests/fixtures.mjs";

const origin = "http://127.0.0.1:3100";
const secretFile = "AUTH_USER=admin\nAUTH_PASS='secret#hash'\n";
const sessionHeader = "mc-session=token; Path=/; HttpOnly; SameSite=Strict";

test("env parsing and canonical credential reading support quoted and base64 passwords", async (t) => {
  assert.equal(parseEnv(secretFile).AUTH_PASS, "secret#hash");
  const exported = "export AUTH_USER=admin # account\r\nAUTH_PASS=pass#hash # comment\r\n";
  assert.deepEqual(await readLocalAuth("/fixture/.env", async () => exported), {
    username: "admin", password: "pass#hash",
  });
  assert.equal(parseEnv('AUTH_PASS="literal $TOKEN # quoted"').AUTH_PASS, "literal $TOKEN # quoted");
  assert.equal(parseEnv("AUTH_PASS='  keep spaces  '").AUTH_PASS, "  keep spaces  ");
  assert.throws(() => parseEnv('AUTH_PASS="unclosed'), /DESKTOP_ENV_INVALID/);
  assert.equal(await readLocalAuth("/fixture/.env", async () => 'AUTH_PASS="unclosed'), null);
  const root = await fixture(t);
  const file = await put(root, ".env", `${secretFile}AUTH_PASS_B64=dGVzdA==\n`);
  assert.deepEqual(await readLocalAuth(file), { username: "admin", password: "test" });
  assert.equal(await readLocalAuth(`${root}/missing`), null);
  assert.equal(await readLocalAuth(file, async () => "AUTH_USER=admin"), null);
});

test("invalid origins and redirecting credential-free probes never read secrets", async () => {
  await assert.rejects(loginSession({ origin: "http://example.com:3000", read: () => assert.fail("read") }), /ORIGIN_INVALID/);
  for (const redirectEndpoint of ["/health", "/api/auth/login"]) {
    let posts = 0;
    assert.equal(await loginSession({ origin, read: () => assert.fail("read"), fetchImpl: async (url, options) => {
      if (options.method === "POST") posts++;
      return url.endsWith(redirectEndpoint) ? response(307) : response();
    } }), null);
    assert.equal(posts, 0);
  }
});

test("login retries transient failure at same origin and never follows POST redirects", async () => {
  for (const status of [503, 307, 401, 429]) {
    let posts = 0;
    const cookie = await loginSession({ origin, read: async () => secretFile, filePath: "/fixture/.env", wait: noWait,
      fetchImpl: async (url, options) => {
        assert.ok(url.startsWith(`${origin}/`));
        assert.equal(options.redirect, "manual");
        assert.equal(options.credentials, "omit");
        assert.ok(options.signal);
        if (options.method !== "POST") return response(url.endsWith("login") ? 405 : 200);
        posts++;
        assert.deepEqual(JSON.parse(options.body), { username: "admin", password: "secret#hash" });
        return posts === 1 ? response(status) : response(200, {}, [sessionHeader]);
      } });
    assert.equal(posts, status === 503 ? 2 : 1);
    assert.equal(cookie?.value ?? null, status === 503 ? "token" : null);
  }
});

test("missing credentials yield ordinary login with no POST; network failures hide raw errors", async () => {
  assert.equal(await loginSession({ origin, read: async () => "", filePath: "/fixture/.env", fetchImpl: async () => response() }), null);
  assert.equal(await loginSession({ origin, wait: noWait, fetchImpl: async () => { throw new Error("raw secret"); } }), null);
});

test("session cookies preserve Secure and do not accept another domain/path", async () => {
  const cookie = parseSessionCookie(`${sessionHeader}; Secure; Max-Age=100`);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.ok(cookie.expirationDate > Date.now() / 1000);
  for (const header of ["bad=value; Path=/", "mc-session=x; Path=/other", `${sessionHeader}; Domain=localhost`,
    "__Host-mc-session=x; Path=/"]) assert.equal(parseSessionCookie(header), null);
  assert.equal(parseSessionCookie("__Host-mc-session=x; Path=/; Secure").secure, true);
  let sets = 0;
  assert.equal(await applySessionCookie({ set: async (details) => {
    sets++;
    assert.equal(details.secure, true);
    assert.equal(details.url, origin);
    throw new Error("cookie policy");
  } }, cookie, origin), false);
  assert.equal(sets, 1);
  assert.equal(await applySessionCookie({ set: async () => {} }, null, origin), false);
  assert.equal(await applySessionCookie({ set: async () => {} }, parseSessionCookie(sessionHeader), origin), true);
});
