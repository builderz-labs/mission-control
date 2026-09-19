import assert from "node:assert/strict";
import test from "node:test";
import {
  createPinRecord,
  createPinThrottle,
  credentialsFromEnvironment,
  parseEnvironment,
  validPin,
  verifyPin,
} from "./desktop-auth-core.mjs";

test("four-digit PINs use a salted scrypt record and constant-time verification", async () => {
  assert.equal(validPin("1234"), true);
  for (const value of ["123", "12345", "12a4", 1234, null]) assert.equal(validPin(value), false);
  const record = await createPinRecord("1234", () => Buffer.alloc(16, 7));
  assert.deepEqual(Object.keys(record), ["algorithm", "salt", "hash"]);
  assert.equal(record.hash.includes("1234"), false);
  assert.equal(await verifyPin("1234", record), true);
  assert.equal(await verifyPin("9999", record), false);
  assert.equal(await verifyPin("1234", { ...record, hash: "bad" }), false);
  await assert.rejects(createPinRecord("123"), /DESKTOP_PIN_INVALID/);
});

test("desktop credentials parse quoted, commented and base64 environment values", () => {
  const env = parseEnvironment(`export AUTH_USER = operator\nAUTH_PASS='with # hash'\nIGNORED\n`);
  assert.deepEqual(credentialsFromEnvironment(env), { username: "operator", password: "with # hash" });
  assert.deepEqual(credentialsFromEnvironment({ AUTH_PASS_B64: Buffer.from("encoded-password").toString("base64") }),
    { username: "admin", password: "encoded-password" });
  assert.deepEqual(parseEnvironment('AUTH_PASS="line\\nvalue"  '), { AUTH_PASS: "line\nvalue" });
  assert.throws(() => credentialsFromEnvironment({ AUTH_USER: "admin" }), /CREDENTIALS_MISSING/);
});

test("PIN throttling escalates repeated failures and resets after success", () => {
  let time = 10_000;
  const throttle = createPinThrottle(() => time);
  assert.equal(throttle.failure(), 0);
  assert.equal(throttle.failure(), 0);
  assert.equal(throttle.failure(), 5_000);
  assert.equal(throttle.remaining(), 5_000);
  time += 5_000;
  assert.equal(throttle.remaining(), 0);
  assert.equal(throttle.failure(), 15_000);
  throttle.success();
  assert.equal(throttle.remaining(), 0);
  assert.equal(throttle.failure(), 0);
});
