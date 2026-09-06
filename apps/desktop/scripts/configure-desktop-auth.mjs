import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AUTH_FILE_NAME, writePinConfiguration } from "../src/desktop-auth-store.mjs";

async function readPin(input = process.stdin) {
  let value = "";
  for await (const chunk of input) {
    value += chunk;
    if (value.length > 64) throw new Error("DESKTOP_PIN_INVALID");
  }
  value = value.trim();
  if (!/^\d{4}$/.test(value)) throw new Error("DESKTOP_PIN_INVALID");
  return value;
}

export async function configure(args = process.argv.slice(2), { home = os.homedir(), input = process.stdin } = {}) {
  if (args.length) throw new Error("DESKTOP_AUTH_ARGUMENT_INVALID");
  const file = path.join(home, "Library", "Application Support", "Mission Control", AUTH_FILE_NAME);
  const pin = await readPin(input);
  await writePinConfiguration(file, pin);
  return { configured: true, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configure().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    const code = /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "DESKTOP_AUTH_CONFIGURE_FAILED";
    console.error(`Desktop authentication setup failed (${code}).`);
    process.exitCode = 1;
  });
}
