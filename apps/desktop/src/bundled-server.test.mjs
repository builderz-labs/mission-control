import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUNDLED_PORT,
  bundledOrigin,
  dataDir,
  envFile,
  hasBundledServer,
  isCompileSplash,
  resolveNode,
  runtimeNode,
  serverDir,
  spawnEnv,
  startBundledServer,
  waitHealthy,
} from "./bundled-server.mjs";

test("bundled origin stays on loopback", () => {
  assert.equal(bundledOrigin(), "http://127.0.0.1:18791");
  assert.equal(bundledOrigin(19000), "http://127.0.0.1:19000");
  assert.equal(BUNDLED_PORT, 18791);
});

test("server paths sit under the app resources root", () => {
  const root = "/tmp/Mission Control.app/Contents/Resources/app";
  assert.equal(serverDir(root), path.join(root, "server"));
  assert.equal(runtimeNode(root), path.join(root, "runtime", "node"));
  assert.equal(hasBundledServer(root), false);
});

test("resolveNode prefers MC_NODE_BIN then bundled runtime", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mc-node-"));
  const bundled = runtimeNode(dir);
  await mkdir(path.dirname(bundled), { recursive: true });
  await writeFile(bundled, "#!/bin/sh\n");
  assert.equal(resolveNode(dir, { MC_NODE_BIN: "/opt/node" }), "/opt/node");
  assert.equal(resolveNode(dir, {}), bundled);
  await rm(dir, { recursive: true, force: true });
});

test("data and env files prefer the Dev checkout when present", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "mc-home-"));
  const data = path.join(home, "Dev", "mission-control", ".data");
  const env = path.join(home, "Dev", "mission-control", ".env");
  await mkdir(data, { recursive: true });
  await writeFile(env, "AUTH_USER=admin\n");
  assert.equal(dataDir(home), data);
  assert.equal(envFile(home), env);
  await rm(home, { recursive: true, force: true });
});

test("spawnEnv forces loopback production and disables HSTS", () => {
  const env = spawnEnv({
    port: 18791,
    dataDirectory: "/tmp/mc-data",
    fileEnv: { AUTH_USER: "admin", HOSTNAME: "Mac.local" },
    env: { PATH: "/bin", HOME: "/tmp" },
    home: "/tmp",
  });
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.PORT, "18791");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.MC_COOKIE_SECURE, "0");
  assert.equal(env.MC_DISABLE_HSTS, "1");
  assert.equal(env.MISSION_CONTROL_DATA_DIR, "/tmp/mc-data");
  assert.equal(env.AUTH_USER, "admin");
});

test("compile splash is the next-dev placeholder only", () => {
  assert.equal(isCompileSplash("<p>Loading Mission Control</p>"), true);
  assert.equal(
    isCompileSplash("<script src='/_next/static/chunk.js'></script>Loading Mission Control"),
    false,
  );
});

test("waitHealthy retries until status ok", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new Error("down");
    return { ok: true, json: async () => ({ status: "ok" }) };
  };
  assert.equal(await waitHealthy("http://127.0.0.1:18791/health", {
    fetchImpl,
    wait: async () => {},
    tries: 5,
  }), true);
  assert.equal(calls, 3);
});

test("startBundledServer reuses a healthy listener", async () => {
  let spawned = false;
  const result = await startBundledServer({
    appRoot: "/missing",
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ok" }) }),
    spawn: () => {
      spawned = true;
      return { killed: false, kill() {} };
    },
  });
  assert.equal(result.reused, true);
  assert.equal(result.child, null);
  assert.equal(result.origin, "http://127.0.0.1:18791");
  assert.equal(spawned, false);
});

test("startBundledServer spawns node server.js from the bundle", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mc-bundle-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), "/* next */\n");
  let spawned = null;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error("down");
    return { ok: true, json: async () => ({ status: "ok" }) };
  };
  const result = await startBundledServer({
    appRoot: dir,
    home: dir,
    fetchImpl,
    wait: async () => {},
    spawn: (bin, args, options) => {
      spawned = { bin, args, cwd: options.cwd, env: options.env };
      return { killed: false, kill() {} };
    },
  });
  assert.equal(result.reused, false);
  assert.equal(spawned.args[0], "server.js");
  assert.equal(spawned.cwd, path.join(dir, "server"));
  assert.equal(spawned.env.HOSTNAME, "127.0.0.1");
  assert.equal(spawned.env.PORT, "18791");
  await rm(dir, { recursive: true, force: true });
});
