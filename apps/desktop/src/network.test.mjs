import assert from "node:assert/strict";
import test from "node:test";
import { request } from "./network.mjs";
import { noWait, response } from "../tests/fixtures.mjs";
const url = "http://127.0.0.1:3100/health";

test("timeouts include response bodies and retry once with aborted signals", async () => {
  for (const hangBody of [false, true]) {
    const signals = [];
    await assert.rejects(request(url, { timeoutMs: 10, wait: noWait,
      fetchImpl: async (_url, options) => {
        signals.push(options.signal);
        return hangBody ? response() : new Promise(() => {});
      }, consume: async () => new Promise(() => {}),
    }), /DESKTOP_NETWORK_UNAVAILABLE/);
    assert.equal(signals.length, 2);
    assert.ok(signals.every((signal) => signal.aborted));
  }
});

test("rejects followed redirects, changed response URLs and 3xx without retries", async () => {
  for (const result of [{ ...response(), redirected: true }, { ...response(), url: "http://other:3100/health" }, response(308)]) {
    let calls = 0;
    await assert.rejects(request(url, { fetchImpl: async () => { calls++; return result; } }), /REDIRECT_REJECTED/);
    assert.equal(calls, 1);
  }
});
