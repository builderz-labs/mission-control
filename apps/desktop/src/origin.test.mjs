import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ORIGIN, allowsNavigation, validateOrigin } from "./origin.mjs";
import { secureWindow } from "./window-policy.mjs";

test("defaults to canonical backend; accepts explicit literal loopback HTTP origins", () => {
  assert.equal(validateOrigin(), DEFAULT_ORIGIN);
  for (const value of [DEFAULT_ORIGIN, "http://localhost:3100", "http://[::1]:3100", "http://127.2.3.4:3100/"]) {
    assert.equal(validateOrigin(value), value.replace(/\/$/, ""));
  }
});

test("rejects remote, ambiguous, credentialed, path-bearing and unsafe origins", () => {
  for (const value of ["", null, "https://127.0.0.1:3000", "http://example.com:3000",
    "http://127.0.0.1:3000/login", "http://127.0.0.1:3000?", "http://127.0.0.1:3000#",
    "http://user:password@127.0.0.1:3000", "http://@127.0.0.1:3000", "http://127.1:3000",
    "http://2130706433:3000", "http://0x7f000001:3000", "http://127.000.0.1:3000",
    "http://127.0.0.1:3000/../", "http://127.0.0.1:3000\\", " http://127.0.0.1:3000",
    "http://localhost.:3000", "http://%6cocalhost:3000", "http://[::ffff:127.0.0.1]:3000",
    "http://127.0.0.1", "http://127.0.0.1:80", "http://127.0.0.1:0",
    "http://127.0.0.1:1719", "http://127.0.0.1:4190", "http://127.0.0.1:65536", "http://127.0.0.1:6667", "http://127.0.0.1:10080"]) {
    assert.throws(() => validateOrigin(value), /DESKTOP_ORIGIN_INVALID/, String(value));
  }
});

test("navigation stays at chosen origin and refuses popups, webviews and redirects", () => {
  assert.equal(allowsNavigation(`${DEFAULT_ORIGIN}/tasks?q=1`, DEFAULT_ORIGIN), true);
  for (const url of ["https://example.com", "file:///tmp/a", "javascript:alert(1)",
    "http://localhost:3000", "http://127.0.0.1:3001", "http://user@127.0.0.1:3000"]) {
    assert.equal(allowsNavigation(url, DEFAULT_ORIGIN), false);
  }
  const events = new Map();
  let popup;
  secureWindow({ on: (name, fn) => events.set(name, fn), setWindowOpenHandler: (fn) => { popup = fn; } }, DEFAULT_ORIGIN);
  assert.deepEqual(popup(), { action: "deny" });
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    let blocked = false;
    events.get(name)({ preventDefault() { blocked = true; } }, "https://example.com");
    assert.equal(blocked, true, name);
  }
});
