import assert from "node:assert/strict";
import { Readable } from "node:stream";
import path from "node:path";
import test from "node:test";
import { fixture } from "./fixtures.mjs";
import { configure } from "../scripts/configure-desktop-auth.mjs";
import { readAuthConfiguration } from "../src/desktop-auth-store.mjs";
import { verifyPin } from "../src/desktop-auth-core.mjs";

test("desktop auth configuration reads the PIN from stdin without command arguments", async (t) => {
  const home = await fixture(t);
  const result = await configure([], { home, input: Readable.from(["1234\n"]) });
  assert.equal(result.file, path.join(home, "Library", "Application Support", "Mission Control", "desktop-auth.json"));
  assert.equal(await verifyPin("1234", (await readAuthConfiguration(result.file)).pin), true);
  await assert.rejects(configure(["1234"], { home, input: Readable.from([]) }), /ARGUMENT_INVALID/);
  await assert.rejects(configure([], { home, input: Readable.from(["12x4"]) }), /PIN_INVALID/);
});
