import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { ELECTRON_VERSION, validateBoundary } from "./package-inputs.mjs";

export function run(command, args) {
  try {
    const timeout = path.basename(command) === "ditto" || path.basename(command) === "codesign" ? 300_000 : 120_000;
    return execFileSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { throw new Error(`BUILD_TOOL_FAILED_${path.basename(command)}`); }
}

export function configureBundle(bundle, version, runTool = run) {
  const plist = path.join(bundle, "Contents/Info.plist");
  const values = {
    CFBundleName: "Mission Control", CFBundleDisplayName: "Mission Control",
    CFBundleIdentifier: "com.tylerdevries.mission-control-desktop",
    CFBundleShortVersionString: version,
  };
  for (const [key, value] of Object.entries(values)) {
    runTool("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
  }
  runTool("/usr/bin/plutil", ["-replace", "NSAppTransportSecurity", "-json", "{\"NSAllowsLocalNetworking\":true}", plist]);
}

export async function validateBundle(bundle, payload, runTool = run) {
  if (!(await lstat(bundle)).isDirectory() || (await lstat(bundle)).isSymbolicLink()) {
    throw new Error("BUNDLE_INVALID");
  }
  await validateBoundary(bundle, payload);
  const plist = path.join(bundle, "Contents/Info.plist");
  const identifier = runTool("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist]);
  if (identifier !== "com.tylerdevries.mission-control-desktop") throw new Error("BUNDLE_ID_INVALID");
  const framework = path.join(bundle, "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist");
  const version = runTool("/usr/bin/plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", framework]);
  if (version !== ELECTRON_VERSION) throw new Error("BUNDLE_ELECTRON_INVALID");
  const executable = path.join(bundle, "Contents/MacOS/Electron");
  const arch = runTool("/usr/bin/lipo", ["-archs", executable]);
  if (!arch.split(" ").includes(process.arch === "arm64" ? "arm64" : "x86_64")) throw new Error("BUNDLE_ARCH_INVALID");
  if (((await lstat(executable)).mode & 0o111) === 0 || !(await readFile(executable)).length) throw new Error("BUNDLE_EXECUTABLE_INVALID");
  runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  return true;
}
