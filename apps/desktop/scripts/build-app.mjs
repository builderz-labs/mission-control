import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkoutRoot, PACKAGE_ROOT } from "../src/app-paths.mjs";
import { hash, packageInputs } from "./package-inputs.mjs";
import { resolveElectron } from "./electron-runtime.mjs";
import { exists, installApp } from "./install-app.mjs";
import { configureBundle, run, validateBundle } from "./mac-tools.mjs";
import { buildOptions } from "./build-options.mjs";

export async function validCache(directory, inputs, validate = validateBundle) {
  try {
    await validate(path.join(directory, "Mission Control.app"), inputs.payload);
    const manifest = JSON.parse(await readFile(path.join(directory, "artifact.json"), "utf8"));
    return manifest.fingerprint === inputs.fingerprint
      && manifest.zipHash === hash(await readFile(path.join(directory, "Mission Control.zip")));
  } catch { return false; }
}

async function stage(directory, runtime, inputs, identity) {
  const bundle = path.join(directory, "Mission Control.app");
  run("/usr/bin/ditto", [runtime, bundle]);
  const resources = path.join(bundle, "Contents/Resources");
  // The pinned stock Electron template must never supply a second app payload.
  if (await exists(path.join(resources, "app")) || await exists(path.join(resources, "app.asar"))) {
    throw new Error("ELECTRON_TEMPLATE_HAS_APP");
  }
  await rm(path.join(resources, "default_app.asar"), { force: true });
  for (const [file, bytes] of inputs.payload) {
    const target = path.join(resources, "app", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  const metadata = JSON.parse(inputs.payload.get("package.json").toString());
  configureBundle(bundle, metadata.version);
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", identity, bundle]);
  await validateBundle(bundle, inputs.payload);
  const zip = path.join(directory, "Mission Control.zip");
  run("/usr/bin/ditto", ["-c", "-k", "--keepParent", bundle, zip]);
  run("/usr/bin/unzip", ["-tq", zip]);
  await writeFile(path.join(directory, "artifact.json"), JSON.stringify({
    fingerprint: inputs.fingerprint, zipHash: hash(await readFile(zip)),
  }));
}

export async function build(args = process.argv.slice(2), env = process.env) {
  const options = buildOptions(args, env);
  if (process.platform !== "darwin") throw new Error("BUILD_REQUIRES_MACOS");
  const runtime = await resolveElectron(PACKAGE_ROOT, {
    override: options.electronPackage, stageOnly: options.stageOnly,
  });
  const inputs = await packageInputs(PACKAGE_ROOT, checkoutRoot({ env }), options.identity);
  let output = options.output;
  if (!output) output = await mkdtemp(path.join(os.tmpdir(), "mc-desktop-output-"));
  await mkdir(output, { recursive: true });
  const directory = path.join(output, inputs.fingerprint);
  if (!await validCache(directory, inputs)) {
    // Preserve invalid outputs for inspection; never silently overwrite an existing artifact.
    if (await exists(directory)) throw new Error("BUILD_CACHE_INVALID_USE_NEW_OUTPUT");
    const temporary = await mkdtemp(path.join(output, ".mc-build-"));
    try {
      await stage(temporary, runtime, inputs, options.identity);
      const { rename } = await import("node:fs/promises");
      await rename(temporary, directory);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  let backup = null;
  if (options.app) {
    ({ backup } = await installApp(path.join(directory, "Mission Control.app"), options.app, {
      validate: (candidate) => validateBundle(candidate, inputs.payload),
      copy: async (source, destination) => run("/usr/bin/ditto", [source, destination]),
    }));
  }
  return { directory, fingerprint: inputs.fingerprint, installed: options.app ?? null, backup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    const code = /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "BUILD_FAILED";
    console.error(`Desktop build failed (${code}). Check pinned Electron, output permissions and signing tools.`);
    process.exitCode = 1;
  });
}
