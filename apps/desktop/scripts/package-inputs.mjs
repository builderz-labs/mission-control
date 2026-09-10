import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

export const ELECTRON_VERSION = "44.2.0";
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function filesUnder(root, relative = "") {
  const result = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const file = path.join(relative, name);
    const stat = await lstat(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("PACKAGE_SYMLINK_REJECTED");
    if (stat.isDirectory()) result.push(...await filesUnder(root, file));
    else if (stat.isFile()) result.push(file);
    else throw new Error("PACKAGE_FILE_INVALID");
  }
  return result;
}

export async function packageInputs(root, checkoutRoot, identity = "-") {
  const source = (await filesUnder(path.join(root, "src")))
    .filter((file) => !file.endsWith(".test.mjs"));
  if (source.some((file) => file.includes(path.sep) || !/\.(mjs|cjs|html)$/.test(file))) {
    throw new Error("PACKAGE_SOURCE_INVALID");
  }
  const payload = new Map();
  payload.set("package.json", await readFile(path.join(root, "package.json")));
  for (const file of source) payload.set(`src/${file}`, await readFile(path.join(root, "src", file)));
  payload.set("desktop-config.json", Buffer.from(`${JSON.stringify({ checkoutRoot })}\n`));
  const inputs = new Map(payload);
  for (const folder of ["scripts", "bin"]) {
    for (const file of await filesUnder(path.join(root, folder))) {
      inputs.set(`${folder}/${file}`, await readFile(path.join(root, folder, file)));
    }
  }
  const fingerprint = hash(JSON.stringify({
    electron: ELECTRON_VERSION, arch: process.arch, identity,
    files: [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([file, bytes]) => [file, hash(bytes)]),
  }));
  payload.set("build-metadata.json", Buffer.from(`${JSON.stringify({ fingerprint, electron: ELECTRON_VERSION })}\n`));
  return { fingerprint, payload };
}

export async function validateBoundary(app, payload) {
  const root = path.join(app, "Contents/Resources/app");
  // No alternate payloads, backend assets, symlinks or empty forbidden directories.
  async function check(directory, prefix = "") {
    for (const name of await readdir(directory)) {
      const relative = `${prefix}${name}`;
      const stat = await lstat(path.join(directory, name));
      if (stat.isSymbolicLink()) throw new Error("PACKAGE_BOUNDARY_INVALID");
      if (stat.isDirectory()) {
        if (relative !== "src") throw new Error("PACKAGE_BOUNDARY_INVALID");
        await check(path.join(directory, name), "src/");
      } else if (!stat.isFile() || !payload.has(relative)) throw new Error("PACKAGE_BOUNDARY_INVALID");
    }
  }
  for (const name of await readdir(path.dirname(root))) {
    if (name !== "app" && name !== "electron.icns" && !/^[a-z]{2,3}(?:_[A-Z]{2}|_[0-9]{3})?\.lproj$/.test(name)) {
      throw new Error("PACKAGE_BOUNDARY_INVALID");
    }
  }
  if ((await lstat(root)).isSymbolicLink()) throw new Error("PACKAGE_BOUNDARY_INVALID");
  await check(root);
  for (const [file, bytes] of payload) {
    if (!bytes.equals(await readFile(path.join(root, file)))) throw new Error("PACKAGE_CONTENT_INVALID");
  }
  return true;
}
