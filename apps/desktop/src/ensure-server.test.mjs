import assert from "node:assert/strict";
import test from "node:test";
import { ensureServer, healthStatus, kickstart, kickstartLabel } from "./ensure-server.mjs";
import { DEFAULT_ORIGIN } from "./origin.mjs";
import { noWait, response } from "../tests/fixtures.mjs";

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

test("healthy backend and transient health failures never kickstart", async () => {
  for (const failures of [0, 1]) {
    let calls = 0;
    assert.equal(await ensureServer({ wait: noWait, fetchImpl: async () => {
      if (calls++ < failures) return response(503);
      return response();
    }, run: () => assert.fail("must reuse") }), true);
  }
});

test("only canonical unavailable backend gets one non-destructive kickstart", async () => {
  let calls = 0;
  let launches = 0;
  const ok = await ensureServer({ wait: noWait, fetchImpl: async () => {
    if (++calls <= 2) throw new Error("down");
    return response();
  }, run: (command, args, options, callback) => {
    launches++;
    assert.equal(command, "/bin/launchctl");
    assert.equal(args[0], "kickstart");
    assert.equal(args.includes("-k"), false);
    assert.equal(options.timeout, 10_000);
    callback(null);
  } });
  assert.equal(ok, true);
  assert.equal(launches, 1);
  assert.equal(kickstartLabel(501), "gui/501/com.tylerdevries.mission-control");
  assert.throws(() => kickstartLabel(-1), /USER_INVALID/);
});

test("alternate origins and redirects never mutate service", async () => {
  for (const [origin, fetchImpl] of [
    ["http://127.0.0.1:3100", async () => response(503)],
    [DEFAULT_ORIGIN, async () => response(302)],
  ]) assert.equal(await ensureServer({ origin, fetchImpl, wait: noWait, run: () => assert.fail("no launch") }), false);
});

test("unready or malformed health is unavailable", async () => {
  for (const body of [{ status: "ok", live: false }, { status: "bad" }, null]) {
    assert.equal(await healthStatus(DEFAULT_ORIGIN, { fetchImpl: async () => response(200, body) }), "unavailable");
  }
});

test("launch errors and prolonged service unavailability are safe failures", async () => {
  assert.equal(await kickstart(() => { throw new Error("secret detail"); }), false);
  assert.equal(await kickstart((_command, _args, _options, callback) => callback(new Error("failed"))), false);
  let calls = 0;
  assert.equal(await ensureServer({ wait: noWait, tries: 2, fetchImpl: async () => {
    calls++;
    return response(503);
  }, run: (_command, _args, _options, callback) => callback(null) }), false);
  assert.equal(calls, 6);
});
