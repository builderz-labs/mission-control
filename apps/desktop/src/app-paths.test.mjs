import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { checkoutRoot, discoverRoot } from "./app-paths.mjs";
import { fixture, put } from "../tests/fixtures.mjs";

test("discovers repository relative to package even when cwd is elsewhere", async (t) => {
  const root = await fixture(t);
  await put(root, "apps/desktop/package.json", "{}");
  const start = path.join(root, "apps/desktop/src");
  assert.equal(discoverRoot(start), root);
  assert.equal(checkoutRoot({ start, env: {} }), root);
});

test("git worktree metadata resolves to common canonical checkout", async (t) => {
  const root = await fixture(t);
  const canonical = path.join(root, "canonical");
  const worktree = path.join(root, "worktree");
  await put(worktree, "apps/desktop/package.json", "{}");
  await put(worktree, ".git", `gitdir: ${canonical}/.git/worktrees/desktop\n`);
  await put(canonical, ".git/worktrees/desktop/commondir", "../..\n");
  assert.equal(checkoutRoot({ start: worktree, env: {} }), canonical);
});

test("absolute root overrides and packaged config take precedence", async (t) => {
  const root = await fixture(t);
  assert.equal(checkoutRoot({ env: { MISSION_CONTROL_ROOT: root } }), root);
  assert.throws(() => checkoutRoot({ env: { MISSION_CONTROL_ROOT: "relative" } }), /ROOT_INVALID/);
  await put(root, "desktop-config.json", JSON.stringify({ checkoutRoot: "/canonical" }));
  assert.equal(checkoutRoot({ start: root, env: {} }), "/canonical");
  assert.equal(checkoutRoot({ start: "/nonexistent/fixture", home: "/fixture-home", env: {} }), "/fixture-home/Dev/mission-control");
});
