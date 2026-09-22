import { createHash } from "node:crypto";
import { ensureServer } from "./ensure-server.mjs";
import { validateOrigin } from "./origin.mjs";

export function partitionForOrigin(origin) {
  return `mc-${createHash("sha256").update(validateOrigin(origin)).digest("hex")}`;
}

// Availability is not identity. Never open a credentials file or perform login here.
export async function openBackend({ origin, loadURL, ensure = ensureServer }) {
  const selected = validateOrigin(origin);
  if (!await ensure({ origin: selected })) return false;
  // The backend redirects unauthenticated requests; an existing session can reopen.
  await loadURL(`${selected}/`);
  return true;
}
