import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  backendOf, LAUNCH_AGENTS, originForPort, planServices, portFromArguments, readPlist, SERVICES,
} from "./service-plan.mjs";
import { DEFAULT_ORIGIN } from "./origin.mjs";

const plists = {
  "com.tylerdevries.mission-control": { EnvironmentVariables: { PORT: "4000" } },
  "ai.openclaw.gateway": { ProgramArguments: ["/bin/sh", "node", "gateway", "--port", "18789"] },
};
const runPlutil = (command, args, _options, callback) => {
  assert.equal(command, "/usr/bin/plutil");
  const label = path.basename(args.at(-1), ".plist");
  callback(null, JSON.stringify(plists[label] ?? {}));
};

test("every declared server is planned from its own plist, not a compiled-in port", async () => {
  const plan = await planServices({ run: runPlutil, env: {} });
  assert.deepEqual(plan.map((service) => [service.key, service.origin]), [
    ["backend", "http://127.0.0.1:4000"],
    ["gateway", "http://127.0.0.1:18789"],
  ]);
  assert.equal(plan.length, SERVICES.length);
  assert.equal(backendOf(plan).key, "backend");
  assert.equal(backendOf([]), null);
  for (const service of plan) {
    assert.equal(service.plist, path.join(LAUNCH_AGENTS, `${service.label}.plist`));
  }
});

test("a missing, unreadable or portless plist falls back to the service default", async () => {
  for (const run of [
    (_command, _args, _options, callback) => callback(new Error("no such file")),
    (_command, _args, _options, callback) => callback(null, "not json"),
    (_command, _args, _options, callback) => callback(null, "{}"),
    () => { throw new Error("spawn refused"); },
  ]) {
    const plan = await planServices({ run, env: {} });
    assert.deepEqual(plan.map((service) => service.origin),
      ["http://127.0.0.1:3000", "http://127.0.0.1:18789"]);
  }
  assert.equal(await readPlist("/nowhere.plist", (_c, _a, _o, cb) => cb(new Error("x"))), null);
});

test("an explicit override is honoured exactly or rejected, and never reaches the gateway", async () => {
  const [backend, gateway] = await planServices({
    run: runPlutil, env: { MC_DESKTOP_URL: "http://127.0.0.1:5173" },
  });
  assert.equal(backend.origin, "http://127.0.0.1:5173");
  assert.equal(gateway.origin, "http://127.0.0.1:18789");
  for (const value of ["https://example.com", "http://evil.test:3000", ""]) {
    await assert.rejects(planServices({ run: runPlutil, env: { MC_DESKTOP_URL: value } }),
      /ORIGIN_INVALID/);
  }
});

test("ports are read from either --port spelling and unusable values are refused", () => {
  assert.equal(portFromArguments(["gateway", "--port", "18789"]), 18789);
  assert.equal(portFromArguments(["gateway", "--port=18789"]), 18789);
  for (const args of [["gateway"], ["--port"], null, "--port 1"]) {
    assert.ok(Number.isNaN(portFromArguments(args)));
  }
  assert.equal(originForPort(4000, 3000), "http://127.0.0.1:4000");
  // Privileged, blocked, out-of-range and non-numeric ports fall back, then default.
  for (const port of [80, 6000, 70_000, NaN, "4000; rm -rf /"]) {
    assert.equal(originForPort(port, 3000), DEFAULT_ORIGIN);
  }
  assert.equal(originForPort(NaN, NaN), DEFAULT_ORIGIN);
});

test("each server accepts only its own health shape", () => {
  const accepts = Object.fromEntries(SERVICES.map((service) => [service.key, service.accepts]));
  assert.equal(accepts.backend({ status: "ok" }), true);
  for (const body of [{ status: "ok", live: false }, { status: "bad" }, { ok: true }, null]) {
    assert.ok(!accepts.backend(body));
  }
  assert.equal(accepts.gateway({ ok: true, status: "live" }), true);
  assert.equal(accepts.gateway({ status: "live" }), true);
  for (const body of [{ ok: false }, { status: "starting" }, null]) assert.ok(!accepts.gateway(body));
});
