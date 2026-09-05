import assert from "node:assert/strict";
import test from "node:test";
import { openBackend, partitionForOrigin } from "./backend-window.mjs";
import { ensureServer } from "./ensure-server.mjs";
import { response } from "../tests/fixtures.mjs";

test("session partitions are ephemeral and separate different full origins", () => {
  const first = partitionForOrigin("http://127.0.0.1:3000");
  assert.equal(first.startsWith("persist:"), false);
  assert.equal(first, partitionForOrigin("http://127.0.0.1:3000/"));
  for (const origin of ["http://127.0.0.1:3100", "http://localhost:3000"]) {
    assert.notEqual(first, partitionForOrigin(origin));
  }
  // A stale session in the legacy/default partition is never selected.
  const stores = new Map([["", { cookie: "legacy" }], [first, { cookie: "origin-one" }]]);
  assert.equal(stores.get(partitionForOrigin("http://127.0.0.1:3100")), undefined);
});

test("a healthy service gets only a credential-free probe then backend-owned authentication", async () => {
  const calls = [];
  const urls = [];
  assert.equal(await openBackend({ origin: "http://127.0.0.1:3000", loadURL: async (url) => urls.push(url),
    ensure: (options) => ensureServer({ ...options, fetchImpl: async (url, init) => {
      calls.push(url);
      assert.equal(init.body, undefined);
      assert.equal(init.headers, undefined);
      assert.equal(init.credentials, "omit");
      return response();
    } }),
  }), true);
  assert.deepEqual(calls, ["http://127.0.0.1:3000/health"]);
  assert.deepEqual(urls, ["http://127.0.0.1:3000/"]);
});

test("unavailable or invalid services never navigate", async () => {
  const loadURL = () => assert.fail("unexpected navigation");
  assert.equal(await openBackend({ origin: "http://127.0.0.1:3100", loadURL, ensure: async () => false }), false);
  await assert.rejects(openBackend({ origin: "https://example.com", loadURL }), /ORIGIN_INVALID/);
});
