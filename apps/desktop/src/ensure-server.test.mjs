import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureService, ensureServer, ensureServices, healthStatus, launchctl, serviceTarget, startService,
} from "./ensure-server.mjs";
import { DEFAULT_ORIGIN } from "./origin.mjs";
import { noWait, response } from "../tests/fixtures.mjs";

const BACKEND = {
  key: "backend", label: "com.tylerdevries.mission-control", required: true,
  origin: DEFAULT_ORIGIN, plist: "/Users/x/Library/LaunchAgents/com.tylerdevries.mission-control.plist",
  accepts: (body) => body?.status === "ok" && body.live !== false,
};
const GATEWAY = {
  key: "gateway", label: "ai.openclaw.gateway", required: false,
  origin: "http://127.0.0.1:18789", plist: "/Users/x/Library/LaunchAgents/ai.openclaw.gateway.plist",
  accepts: (body) => body?.ok === true,
};
const ok = (_command, _args, _options, callback) => callback(null);
const plan = () => [{ ...BACKEND }, { ...GATEWAY }];

test("health uses selected origin, bounded manual requests, retries transport failures", async () => {
  let calls = 0;
  assert.equal(await healthStatus("http://127.0.0.1:3100", { wait: noWait, fetchImpl: async (url, options) => {
    assert.equal(url, "http://127.0.0.1:3100/health");
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal);
    if (++calls === 1) throw new Error("private details");
    return response();
  } }), "healthy");
  assert.equal(calls, 2);
});

test("unready, malformed or foreign-shaped health is unavailable", async () => {
  for (const body of [{ status: "ok", live: false }, { status: "bad" }, null]) {
    assert.equal(await healthStatus(DEFAULT_ORIGIN, { fetchImpl: async () => response(200, body) }),
      "unavailable");
  }
  assert.equal(await healthStatus(DEFAULT_ORIGIN, {
    accepts: GATEWAY.accepts, fetchImpl: async () => response(200, { status: "ok" }),
  }), "unavailable");
  assert.equal(await healthStatus(DEFAULT_ORIGIN, {
    accepts: GATEWAY.accepts, fetchImpl: async () => response(200, { ok: true }),
  }), "healthy");
});

test("healthy servers and transient health failures are never restarted", async () => {
  for (const failures of [0, 1]) {
    let calls = 0;
    assert.equal(await ensureService({ ...BACKEND }, { wait: noWait, fetchImpl: async () => {
      if (calls++ < failures) return response(503);
      return response();
    }, run: () => assert.fail("must reuse") }), true);
  }
});

test("an unavailable server is enabled then non-destructively kickstarted", async () => {
  let calls = 0;
  const commands = [];
  const started = await ensureService({ ...BACKEND }, { wait: noWait, uid: 501, fetchImpl: async () => {
    if (++calls <= 2) throw new Error("down");
    return response();
  }, run: (command, args, options, callback) => {
    assert.equal(command, "/bin/launchctl");
    assert.equal(args.includes("-k"), false);
    assert.equal(options.timeout, 10_000);
    commands.push(args.join(" "));
    callback(null);
  } });
  assert.equal(started, true);
  assert.deepEqual(commands, [
    "enable gui/501/com.tylerdevries.mission-control",
    "kickstart gui/501/com.tylerdevries.mission-control",
  ]);
});

test("a server that was never loaded is bootstrapped from its plist, then started", async () => {
  const commands = [];
  let kickstarts = 0;
  const started = await ensureService({ ...GATEWAY }, { wait: noWait, uid: 501,
    fetchImpl: async () => (commands.length < 3 ? response(503) : response(200, { ok: true })),
    run: (_command, args, _options, callback) => {
      commands.push(args.join(" "));
      // The first kickstart fails the way launchctl fails for an unloaded service.
      callback(args[0] === "kickstart" && kickstarts++ === 0 ? new Error("No such process") : null);
    } });
  assert.equal(started, true);
  assert.deepEqual(commands, [
    "enable gui/501/ai.openclaw.gateway",
    "kickstart gui/501/ai.openclaw.gateway",
    "bootstrap gui/501 /Users/x/Library/LaunchAgents/ai.openclaw.gateway.plist",
    "kickstart gui/501/ai.openclaw.gateway",
  ]);
});

test("a redirecting origin never mutates any service", async () => {
  assert.equal(await ensureService({ ...BACKEND }, {
    fetchImpl: async () => response(302), wait: noWait, run: () => assert.fail("no launch"),
  }), false);
});

test("launch errors and prolonged unavailability are safe, bounded failures", async () => {
  assert.equal(await launchctl(["kickstart"], () => { throw new Error("secret detail"); }), false);
  assert.equal(await launchctl(["kickstart"], (_c, _a, _o, callback) => callback(new Error("failed"))),
    false);
  assert.equal(await startService({ ...BACKEND, plist: "" },
    { uid: 501, run: (_c, _a, _o, callback) => callback(new Error("failed")) }), false);
  let calls = 0;
  assert.equal(await ensureService({ ...BACKEND }, { wait: noWait, tries: 2, uid: 501,
    fetchImpl: async () => { calls++; return response(503); }, run: ok }), false);
  assert.equal(calls, 6);
});

test("service targets reject an invalid user or label", () => {
  assert.equal(serviceTarget("ai.openclaw.gateway", 501), "gui/501/ai.openclaw.gateway");
  assert.throws(() => serviceTarget("ai.openclaw.gateway", -1), /USER_INVALID/);
  for (const label of ["", "-bad", "a b", "a/b", undefined, "a;rm -rf /"]) {
    assert.throws(() => serviceTarget(label, 501), /LABEL_INVALID/);
  }
});

test("pressing the app starts every planned server, in parallel, not just the backend", async () => {
  const probed = [];
  const launched = [];
  const results = ensureServices(plan(), { wait: noWait, uid: 501,
    fetchImpl: async (url) => { probed.push(url); return response(503); },
    run: (_command, args, _options, callback) => { launched.push(args.join(" ")); callback(null); } });
  assert.deepEqual([...results.keys()], ["backend", "gateway"]);
  // Both were probed before either finished: nothing is serialised behind the backend.
  assert.deepEqual(probed, ["http://127.0.0.1:3000/health", "http://127.0.0.1:18789/health"]);
  await Promise.all(results.values());
  assert.deepEqual(launched.filter((entry) => entry.startsWith("kickstart")).sort(), [
    "kickstart gui/501/ai.openclaw.gateway",
    "kickstart gui/501/com.tylerdevries.mission-control",
  ]);
});

test("a failed secondary server is reported but never blocks the window", async () => {
  const logged = [];
  const started = await ensureServer({ origin: DEFAULT_ORIGIN, plan: plan(), wait: noWait, tries: 1,
    uid: 501, log: (line) => logged.push(line),
    fetchImpl: async (url) => (url.includes(":3000") ? response() : response(503)), run: ok });
  assert.equal(started, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logged, ["[desktop] service_unavailable gateway"]);
});

test("a foreign or unplanned backend origin starts nothing", async () => {
  const run = () => assert.fail("no launch");
  assert.equal(await ensureServer({ origin: "http://127.0.0.1:3100", plan: plan(), run,
    wait: noWait, fetchImpl: async () => response(503) }), false);
  assert.equal(await ensureServer({ origin: DEFAULT_ORIGIN, plan: [{ ...GATEWAY }], run,
    wait: noWait, fetchImpl: async () => response(503) }), false);
  assert.equal(await ensureServer({ plan: [], run }), false);
});
