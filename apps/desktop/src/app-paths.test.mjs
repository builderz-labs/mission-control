import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appBundle,
  desktopRoot,
  electronBinary,
  pathTxtContents,
} from "./app-paths.mjs";

test("desktopRoot stays under ~/Dev", () => {
  const home = "/Users/example";
  assert.equal(desktopRoot(home), path.join(home, "Dev", "mission-control-desktop"));
});

test("appBundle is a user Applications app", () => {
  const home = "/Users/example";
  assert.equal(appBundle(home), path.join(home, "Applications", "Mission Control.app"));
});

test("electron path.txt has no newline", () => {
  const text = pathTxtContents();
  assert.equal(text.includes("\n"), false);
  assert.equal(text, "Electron.app/Contents/MacOS/Electron");
});

test("electronBinary joins dist without a trailing newline", () => {
  const bin = electronBinary("/tmp/root");
  assert.equal(bin.endsWith("Electron"), true);
  assert.equal(path.basename(bin), "Electron");
});

test("default home matches this machine", () => {
  assert.equal(appBundle().startsWith(os.homedir()), true);
});
