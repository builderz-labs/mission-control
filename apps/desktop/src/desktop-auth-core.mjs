import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PIN_PATTERN = /^\d{4}$/;
const KEY_BYTES = 32;

function derive(pin, salt) {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

export function validPin(pin) {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

export async function createPinRecord(pin, random = randomBytes) {
  if (!validPin(pin)) throw new Error("DESKTOP_PIN_INVALID");
  const salt = random(16);
  const hash = await derive(pin, salt);
  return { algorithm: "scrypt-v1", salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export async function verifyPin(pin, record) {
  if (!validPin(pin) || record?.algorithm !== "scrypt-v1") return false;
  try {
    const salt = Buffer.from(record.salt, "base64");
    const expected = Buffer.from(record.hash, "base64");
    if (salt.length !== 16 || expected.length !== KEY_BYTES) return false;
    const actual = await derive(pin, salt);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

function unquote(value) {
  value = value.trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(n|r|t|"|\\)/g, (_match, code) => ({
      n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\",
    })[code]);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseEnvironment(source) {
  const values = {};
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

export function credentialsFromEnvironment(env) {
  const username = env.AUTH_USER?.trim() || "admin";
  let password = env.AUTH_PASS;
  if (env.AUTH_PASS_B64?.trim()) {
    try {
      const encoded = env.AUTH_PASS_B64.trim();
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      if (decoded && Buffer.from(decoded).toString("base64") === encoded) password = decoded;
    } catch { /* Fall through to AUTH_PASS. */ }
  }
  if (!username || typeof password !== "string" || !password) {
    throw new Error("DESKTOP_ACCOUNT_CREDENTIALS_MISSING");
  }
  return { username, password };
}

export function createPinThrottle(now = () => Date.now()) {
  let failures = 0;
  let blockedUntil = 0;
  return {
    remaining() { return Math.max(0, blockedUntil - now()); },
    success() { failures = 0; blockedUntil = 0; },
    failure() {
      failures += 1;
      const delays = [0, 0, 5_000, 15_000, 60_000, 300_000];
      blockedUntil = now() + delays[Math.min(failures, delays.length) - 1];
      return Math.max(0, blockedUntil - now());
    },
  };
}
