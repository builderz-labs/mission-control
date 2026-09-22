import { cp, lstat, mkdir, mkdtemp, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Candidate lives beside the destination, so all publication renames share a filesystem.
// The old app is retained as a sibling backup. A failed publication restores it.
export async function installApp(source, destination, options = {}) {
  if (!path.isAbsolute(destination) || !destination.endsWith(".app") || source === destination) {
    throw new Error("INSTALL_PATH_INVALID");
  }
  if (typeof options.validate !== "function") throw new Error("INSTALL_VALIDATOR_REQUIRED");
  await mkdir(path.dirname(destination), { recursive: true });
  const lock = `${destination}.install-lock`;
  try { await mkdir(lock); } catch { throw new Error("INSTALL_LOCK_UNAVAILABLE"); }
  try { return await publishCandidate(source, destination, options); }
  finally { await rmdir(lock); }
}

async function publishCandidate(source, destination, {
  validate, move = rename, copy = cp,
}) {
  if (await exists(destination)) {
    try {
      await validate(destination);
      return { backup: null, unchanged: true };
    } catch { /* Different or invalid installed payload: replace after staging. */ }
  }
  const staging = await mkdtemp(path.join(path.dirname(destination), ".mc-install-"));
  const candidate = path.join(staging, "Mission Control.app");
  const backup = `${destination}.backup-${randomUUID()}`;
  let saved = false;
  let keepStaging = false;
  try {
    await copy(source, candidate, { recursive: true, dereference: false, verbatimSymlinks: true });
    await validate(candidate);
    if (await exists(destination)) {
      if (!(await lstat(destination)).isDirectory()) throw new Error("INSTALL_TARGET_INVALID");
      await move(destination, backup);
      saved = true;
    }
    try { await move(candidate, destination); }
    catch {
      if (saved) {
        try { await move(backup, destination); }
        catch { keepStaging = true; throw new Error("INSTALL_ROLLBACK_FAILED_OLD_APP_PRESERVED"); }
      }
      throw new Error("INSTALL_FAILED_PREVIOUS_APP_RESTORED");
    }
    return { backup: saved ? backup : null };
  } finally {
    // Only our unique temporary directory is removed, never an application destination.
    if (!keepStaging) await rm(staging, { recursive: true, force: true });
  }
}
