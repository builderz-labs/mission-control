import assert from "node:assert/strict";
import test from "node:test";
import { configureRequestCookies, isBackendRequest } from "./request-policy.mjs";

test("cookie authority compares host, port and transport including WebSocket", () => {
  const origin = "http://127.0.0.1:3000";
  for (const url of [origin, `${origin}/api/tasks`, "ws://127.0.0.1:3000/events"]) {
    assert.equal(isBackendRequest(url, origin), true);
  }
  for (const url of ["ws://127.0.0.1:18789", "http://127.0.0.1:3100", "http://localhost:3000",
    "wss://127.0.0.1:3000", "file:///tmp/example", "invalid"]) assert.equal(isBackendRequest(url, origin), false);
});

test("foreign requests and responses cannot carry ambient cookies; gateway auth is preserved", () => {
  const origin = "http://127.0.0.1:3000";
  let before;
  let received;
  configureRequestCookies({ webRequest: {
    onBeforeSendHeaders: (filter, fn) => { assert.ok(filter.urls.includes("ws://*/*")); before = fn; },
    onHeadersReceived: (filter, fn) => { assert.ok(filter.urls.includes("wss://*/*")); received = fn; },
  } }, origin);
  for (const url of [origin, "ws://127.0.0.1:18789", "http://127.0.0.1:3100", "https://example.com"]) {
    const requestHeaders = { cOoKiE: "synthetic-session", Authorization: "synthetic-gateway", Origin: origin };
    const responseHeaders = { "Set-Cookie": ["synthetic-session"], "Content-Type": ["application/json"] };
    before({ url, requestHeaders }, (result) => {
      assert.equal(result.requestHeaders.cOoKiE, url === origin ? "synthetic-session" : undefined);
      assert.equal(result.requestHeaders.Authorization, "synthetic-gateway");
      assert.equal(result.requestHeaders.Origin, origin);
    });
    received({ url, responseHeaders }, (result) => {
      assert.deepEqual(result.responseHeaders["Set-Cookie"], url === origin ? ["synthetic-session"] : undefined);
      assert.deepEqual(result.responseHeaders["Content-Type"], ["application/json"]);
    });
    assert.equal(requestHeaders.cOoKiE, "synthetic-session");
  }
});
