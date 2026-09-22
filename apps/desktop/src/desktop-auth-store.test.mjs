import assert from "node:assert/strict";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture, put } from "../tests/fixtures.mjs";
import { readAuthConfiguration, readDesktopCredentials, writePinConfiguration } from "./desktop-auth-store.mjs";
import { verifyPin } from "./desktop-auth-core.mjs";

test("PIN configuration is private, replaceable and rejects relative paths", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "state", "desktop-auth.json");
  await writePinConfiguration(file, "1234");
  const config = await readAuthConfiguration(file);
  assert.equal(await verifyPin("1234", config.pin), true);
  assert.equal((await import("node:fs/promises").then(({ stat }) => stat(file))).mode & 0o777, 0o600);
  await writePinConfiguration(file, "5678");
  assert.equal(await verifyPin("5678", (await readAuthConfiguration(file)).pin), true);
  await assert.rejects(writePinConfiguration("relative", "1234"), /PATH_INVALID/);
});

test("auth configuration refuses symlinks and malformed or oversized content", async (t) => {
  const root = await fixture(t);
  const target = await put(root, "target.json", JSON.stringify({ version: 1, pin: {} }));
  await symlink(target, path.join(root, "linked.json"));
  assert.equal(await readAuthConfiguration(path.join(root, "linked.json")), null);
  await put(root, "bad.json", "not-json");
  await assert.rejects(readAuthConfiguration(path.join(root, "bad.json")), /CONFIG_INVALID/);
  await put(root, "large.json", "x".repeat(16_385));
  await assert.rejects(readAuthConfiguration(path.join(root, "large.json")), /CONFIG_INVALID/);
});

test("desktop credentials are read only from a regular canonical env file", async (t) => {
  const root = await fixture(t);
  await put(root, ".env", "AUTH_USER=pilot\nAUTH_PASS=secret-value\n");
  assert.deepEqual(await readDesktopCredentials(root), { username: "pilot", password: "secret-value" });
  await chmod(path.join(root, ".env"), 0o600);
  await mkdir(path.join(root, "nested"));
  await assert.rejects(readDesktopCredentials(path.join(root, "nested")), /CREDENTIALS_MISSING/);
  await assert.rejects(readDesktopCredentials("relative"), /ROOT_INVALID/);
});
