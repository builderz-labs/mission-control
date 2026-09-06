import assert from "node:assert/strict";
import { chmod, mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture, put } from "./fixtures.mjs";
import { hash, packageInputs, validateBoundary } from "../scripts/package-inputs.mjs";
import { validCache } from "../scripts/build-app.mjs";
import { resolveElectron } from "../scripts/electron-runtime.mjs";
import { buildOptions } from "../scripts/build-options.mjs";
import { configureBundle, run } from "../scripts/mac-tools.mjs";

async function packageFixture(t) {
  const root = await fixture(t);
  await put(root, "package.json", '{"name":"fixture"}');
  await put(root, "src/main.mjs", "// main");
  await put(root, "src/preload.cjs", "// preload");
  await put(root, "src/main.test.mjs", "// test");
  await put(root, "scripts/build-app.mjs", "// build");
  await put(root, "bin/open", "// open");
  return root;
}

async function payloadFixture(t, inputs) {
  const root = await fixture(t);
  for (const [file, bytes] of inputs.payload) await put(root, `Mission Control.app/Contents/Resources/app/${file}`, bytes);
  return root;
}

test("fingerprint changes with source, package, build scripts, launcher, root and signing inputs", async (t) => {
  const root = await packageFixture(t);
  let previous = await packageInputs(root, "/canonical");
  assert.equal(previous.payload.has("src/main.test.mjs"), false);
  assert.equal(previous.payload.has("src/preload.cjs"), true);
  assert.equal(previous.payload.has("scripts/build-app.mjs"), false);
  for (const file of ["src/main.mjs", "package.json", "scripts/build-app.mjs", "bin/open"]) {
    await put(root, file, `changed ${file}`);
    const next = await packageInputs(root, "/canonical");
    assert.notEqual(next.fingerprint, previous.fingerprint, file);
    previous = next;
  }
  assert.notEqual((await packageInputs(root, "/other")).fingerprint, previous.fingerprint);
  assert.notEqual((await packageInputs(root, "/canonical", "identity")).fingerprint, previous.fingerprint);
  const metadata = JSON.parse(previous.payload.get("build-metadata.json"));
  assert.equal(metadata.electron, "44.2.0");
});

test("boundary rejects forbidden files, empty directories, changed source and symlinks", async (t) => {
  const inputs = await packageInputs(await packageFixture(t), "/canonical");
  for (const entry of ["server", "backend", "runtime", "node_modules", ".env", ".data", "tests", "src/hidden"]) {
    const output = await payloadFixture(t, inputs);
    const app = path.join(output, "Mission Control.app");
    assert.equal(await validateBoundary(app, inputs.payload), true);
    await mkdir(path.join(app, "Contents/Resources/app", entry));
    await assert.rejects(validateBoundary(app, inputs.payload), /BOUNDARY_INVALID/);
  }
  const output = await payloadFixture(t, inputs);
  const app = path.join(output, "Mission Control.app");
  await put(app, "Contents/Resources/app/src/main.mjs", "modified");
  await assert.rejects(validateBoundary(app, inputs.payload), /CONTENT_INVALID/);
  await symlink("/tmp", path.join(app, "Contents/Resources/app/link"));
  await assert.rejects(validateBoundary(app, inputs.payload), /BOUNDARY_INVALID/);
});

test("cache validates payload and zip digest before hit", async (t) => {
  const inputs = await packageInputs(await packageFixture(t), "/canonical");
  const output = await payloadFixture(t, inputs);
  await put(output, "Mission Control.zip", "archive fixture");
  await put(output, "artifact.json", JSON.stringify({ fingerprint: inputs.fingerprint, zipHash: hash("archive fixture") }));
  assert.equal(await validCache(output, inputs, validateBoundary), true);
  await put(output, "Mission Control.zip", "corrupt");
  assert.equal(await validCache(output, inputs, validateBoundary), false);
  await put(output, "Mission Control.zip", "archive fixture");
  await put(output, "Mission Control.app/Contents/Resources/app/server.js", "bad");
  assert.equal(await validCache(output, inputs, validateBoundary), false);
});

test("Electron resolves through pnpm symlink and rejects missing/mismatched packages", async (t) => {
  const root = await packageFixture(t);
  const electron = path.join(root, "node_modules/.pnpm/electron@44.2.0/node_modules/electron");
  await put(electron, "package.json", '{"name":"electron","version":"44.2.0"}');
  await assert.rejects(resolveElectron(root, { override: electron, stageOnly: true }), /RUNTIME_MISSING_RUN_INSTALL_ELECTRON/);
  await put(electron, "dist/version", "44.2.0");
  const binary = await put(electron, "dist/Electron.app/Contents/MacOS/Electron", "fixture");
  await chmod(binary, 0o755);
  await symlink(".pnpm/electron@44.2.0/node_modules/electron", path.join(root, "node_modules/electron"));
  assert.equal(await resolveElectron(root), path.join(electron, "dist/Electron.app"));
  await assert.rejects(resolveElectron(root, { override: electron }), /STAGE_ONLY/);
  assert.equal(await resolveElectron(root, { override: electron, stageOnly: true }), path.join(electron, "dist/Electron.app"));
  await put(electron, "dist/version", "39.0.0");
  await assert.rejects(resolveElectron(root), /VERSION_MISMATCH/);
  await assert.rejects(resolveElectron(root, { override: `${root}/missing`, stageOnly: true }), /MISSING_RUN_PNPM/);
});

test("CLI is stage-safe and refuses relative paths, ambiguous modes and unknown flags", () => {
  assert.equal(buildOptions([], {}).app, undefined);
  assert.equal(buildOptions(["--stage-only", "--output", "/tmp/test"], {}).stageOnly, true);
  assert.equal(buildOptions([], { MISSION_CONTROL_APP: "/tmp/App.app" }).app, "/tmp/App.app");
  for (const args of [["--output", "relative"], ["--output"], ["--unknown"],
    ["--stage-only", "--install-to", "/tmp/App.app"], ["--electron-package", "/tmp/electron"],
    ["--install-to", "/tmp/not-app"]]) assert.throws(() => buildOptions(args, {}));
});

test("mac tool failures stop the build and metadata commands use argument arrays", async (t) => {
  const root = await fixture(t);
  const secret = await put(root, "failure.mjs", 'process.stderr.write("secret"); process.exit(1);');
  assert.throws(() => run(process.execPath, [secret]), (error) => !error.message.includes("secret"));
  const calls = [];
  configureBundle("/fixture/My App.app", "1.0.0", (...args) => calls.push(args));
  assert.equal(calls.length, 5);
  assert.ok(calls.every(([command, args]) => command === "/usr/bin/plutil" && args.at(-1) === "/fixture/My App.app/Contents/Info.plist"));
  assert.equal((await readFile(secret, "utf8")).includes("secret"), true);
});

test("boundary refuses alternate payloads alongside Resources/app", async (t) => {
  const inputs = await packageInputs(await packageFixture(t), "/canonical");
  const localeOutput = await payloadFixture(t, inputs);
  const localeApp = path.join(localeOutput, "Mission Control.app");
  await put(localeApp, "Contents/Resources/es_419.lproj/InfoPlist.strings", "locale");
  assert.equal(await validateBoundary(localeApp, inputs.payload), true);
  for (const name of ["app.asar", "default_app.asar", "server", "runtime", ".env"]) {
    const output = await payloadFixture(t, inputs);
    const app = path.join(output, "Mission Control.app");
    await put(app, `Contents/Resources/${name}`, "unexpected");
    await assert.rejects(validateBoundary(app, inputs.payload), /BOUNDARY_INVALID/);
  }
});
