import assert from "node:assert/strict";
import test from "node:test";
import { ensureServer, isHealthy, kickstartLabel } from "./ensure-server.mjs";

test("kickstartLabel uses the gui domain", () => {
  assert.equal(kickstartLabel(501), "gui/501/com.tylerdevries.mission-control");
});

test("isHealthy accepts status ok", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status: "ok" }) });
  assert.equal(await isHealthy("http://127.0.0.1:3000/health", fetchImpl), true);
});

test("isHealthy rejects failed fetches", async () => {
  const fetchImpl = async () => { throw new Error("down"); };
  assert.equal(await isHealthy("http://127.0.0.1:3000/health", fetchImpl), false);
});

test("ensureServer kickstarts then waits for health", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 2) throw new Error("down");
    return { ok: true, json: async () => ({ status: "ok" }) };
  };
  let spawned = false;
  const spawn = () => {
    spawned = true;
    return { status: 0 };
  };
  assert.equal(await ensureServer({ fetchImpl, spawn, wait: async () => {}, tries: 5 }), true);
  assert.equal(spawned, true);
});
