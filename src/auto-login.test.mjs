import assert from "node:assert/strict";
import test from "node:test";
import { loginSession, parseSessionCookie } from "./auto-login.mjs";
import { parseEnv } from "./env-file.mjs";

test("parseEnv skips comments and reads AUTH_USER", () => {
  const env = parseEnv("# x\nAUTH_USER=admin\nAUTH_PASS=secret#hash\n");
  assert.equal(env.AUTH_USER, "admin");
  assert.equal(env.AUTH_PASS, "secret#hash");
});

test("parseSessionCookie reads the legacy cookie name", () => {
  const cookie = parseSessionCookie("mc-session=abc123; Path=/; HttpOnly");
  assert.equal(cookie.name, "mc-session");
  assert.equal(cookie.value, "abc123");
});

test("loginSession posts local credentials and returns the cookie", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "mc-login-"));
  const filePath = join(dir, ".env");
  await writeFile(filePath, "AUTH_USER=admin\nAUTH_PASS=test-pass\n");
  let body = "";
  const fetchImpl = async (_url, options) => {
    body = options.body;
    return {
      ok: true,
      headers: { getSetCookie: () => ["mc-session=tok; Path=/"] },
    };
  };
  const cookie = await loginSession({ filePath, fetchImpl });
  await rm(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(body).username, "admin");
  assert.equal(cookie.value, "tok");
});
