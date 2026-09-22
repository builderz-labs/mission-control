import path from "node:path";

export function buildOptions(args, env = process.env) {
  const result = { stageOnly: false, output: env.MC_DESKTOP_OUTPUT,
    app: env.MISSION_CONTROL_APP, electronPackage: env.MC_DESKTOP_ELECTRON_PACKAGE,
    identity: env.MC_DESKTOP_SIGN_IDENTITY || "-" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--stage-only") result.stageOnly = true;
    else if (["--output", "--install-to", "--electron-package"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("BUILD_ARGUMENT_INVALID");
      result[{ "--output": "output", "--install-to": "app", "--electron-package": "electronPackage" }[arg]] = value;
    } else throw new Error("BUILD_ARGUMENT_INVALID");
  }
  for (const key of ["output", "app", "electronPackage"]) {
    if (result[key] && !path.isAbsolute(result[key])) throw new Error("BUILD_PATH_MUST_BE_ABSOLUTE");
  }
  if (result.app && result.stageOnly) throw new Error("BUILD_STAGE_INSTALL_CONFLICT");
  if (result.app && !result.app.endsWith(".app")) throw new Error("INSTALL_PATH_INVALID");
  if (result.electronPackage && !result.stageOnly) throw new Error("ELECTRON_OVERRIDE_STAGE_ONLY");
  return result;
}
