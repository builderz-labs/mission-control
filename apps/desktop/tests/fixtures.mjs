import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mc-desktop-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export async function put(root, relative, value = "fixture") {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
  return file;
}

export const response = (status = 200, body = { status: "ok" }, cookies = []) => ({
  status, ok: status >= 200 && status < 300, json: async () => body,
  headers: { getSetCookie: () => cookies },
});
export const noWait = async () => {};
