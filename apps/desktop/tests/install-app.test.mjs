import assert from "node:assert/strict";
import { readFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { installApp, exists } from "../scripts/install-app.mjs";
import { fixture, put } from "./fixtures.mjs";

async function setup(t) {
  const root = await fixture(t);
  const source = path.join(root, "source.app");
  const destination = path.join(root, "installed.app");
  await put(source, "version", "new");
  await put(destination, "version", "old");
  const validate = async (candidate) => assert.equal(await readFile(path.join(candidate, "version"), "utf8"), "new");
  return { root, source, destination, validate };
}

test("installation preserves old app and uses a validated sibling candidate", async (t) => {
  const { source, destination, validate } = await setup(t);
  const result = await installApp(source, destination, { validate });
  assert.equal(await readFile(path.join(destination, "version"), "utf8"), "new");
  assert.equal(await readFile(path.join(result.backup, "version"), "utf8"), "old");
  assert.equal(await exists(source), true);
});

test("failed validation/copy leaves old app untouched and cleans only owned staging", async (t) => {
  for (const failure of ["validate", "copy"]) {
    const { root, source, destination, validate } = await setup(t);
    await assert.rejects(installApp(source, destination, {
      validate, [failure]: async () => { throw new Error("fixture failure"); },
    }));
    assert.equal(await readFile(path.join(destination, "version"), "utf8"), "old");
    assert.deepEqual((await readdir(root)).sort(), ["installed.app", "source.app"]);
  }
});

test("failed publication restores the previous app without deleting it", async (t) => {
  const { root, source, destination, validate } = await setup(t);
  let moves = 0;
  await assert.rejects(installApp(source, destination, { validate, move: async (from, to) => {
    if (++moves === 2) throw new Error("publication failed");
    return rename(from, to);
  } }), /PREVIOUS_APP_RESTORED/);
  assert.equal(moves, 3);
  assert.equal(await readFile(path.join(destination, "version"), "utf8"), "old");
  assert.deepEqual((await readdir(root)).sort(), ["installed.app", "source.app"]);
});

test("failed rollback preserves both old backup and candidate for recovery", async (t) => {
  const { root, source, destination, validate } = await setup(t);
  let moves = 0;
  await assert.rejects(installApp(source, destination, { validate, move: async (from, to) => {
    if (++moves >= 2) throw new Error("disk failure");
    return rename(from, to);
  } }), /ROLLBACK_FAILED_OLD_APP_PRESERVED/);
  const backup = (await readdir(root)).find((name) => name.startsWith("installed.app.backup-"));
  assert.equal(await readFile(path.join(root, backup, "version"), "utf8"), "old");
  assert.ok((await readdir(root)).some((name) => name.startsWith(".mc-install-")));
});

test("installation requires absolute app destination and validation", async (t) => {
  const { source, destination } = await setup(t);
  await assert.rejects(installApp(source, "relative.app"), /PATH_INVALID/);
  await assert.rejects(installApp(source, destination), /VALIDATOR_REQUIRED/);
});

test("concurrent installation lock fails safely without changing existing app", async (t) => {
  const { mkdir } = await import("node:fs/promises");
  const { source, destination, validate } = await setup(t);
  await mkdir(`${destination}.install-lock`);
  await assert.rejects(installApp(source, destination, { validate }), /INSTALL_LOCK_UNAVAILABLE/);
  assert.equal(await readFile(path.join(destination, "version"), "utf8"), "old");
});
