import assert from "node:assert/strict";
import test from "node:test";
import { isLoginPage } from "./desktop-navigation.mjs";

test("desktop unlock opens only for the exact backend login page", () => {
  const origin = "http://127.0.0.1:3000";
  assert.equal(isLoginPage(`${origin}/login`, origin), true);
  assert.equal(isLoginPage(`${origin}/login?next=%2Fagents`, origin), true);
  for (const url of [`${origin}/`, `${origin}/setup`, "http://127.0.0.1:3100/login", "invalid"]) {
    assert.equal(isLoginPage(url, origin), false);
  }
});
