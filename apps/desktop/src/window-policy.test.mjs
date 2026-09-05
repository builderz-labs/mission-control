import assert from "node:assert/strict";
import test from "node:test";
import { configurePermissions, focusOrCreateWindow } from "./window-policy.mjs";

test("only selected-origin sanitized clipboard writes receive permission", () => {
  const origin = "http://127.0.0.1:3000";
  let request;
  let check;
  configurePermissions({ setPermissionRequestHandler: (fn) => { request = fn; },
    setPermissionCheckHandler: (fn) => { check = fn; } }, origin);
  const contents = { getURL: () => `${origin}/tasks` };
  for (const [permission, url, expected] of [
    ["clipboard-sanitized-write", origin, true],
    ["clipboard-read", origin, false], ["media", origin, false],
    ["clipboard-sanitized-write", "http://127.0.0.1:3100", false],
    ["clipboard-sanitized-write", "https://example.com", false],
  ]) {
    assert.equal(check(contents, permission, url), expected);
    request(contents, permission, (value) => assert.equal(value, expected), { requestingUrl: url });
  }
  assert.equal(check(null, "clipboard-sanitized-write", origin), false);
  assert.equal(check({ getURL: () => "file:///shell.html" }, "clipboard-sanitized-write", origin), false);
});

test("subsequent launches reopen closed windows and focus existing ones", () => {
  const created = { marker: "new" };
  assert.equal(focusOrCreateWindow(undefined, () => created), created);
  assert.equal(focusOrCreateWindow({ isDestroyed: () => true }, () => created), created);
  const calls = [];
  const existing = { isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push("restore"), show: () => calls.push("show"), focus: () => calls.push("focus") };
  assert.equal(focusOrCreateWindow(existing, () => assert.fail("duplicate window")), existing);
  assert.deepEqual(calls, ["restore", "show", "focus"]);
});
