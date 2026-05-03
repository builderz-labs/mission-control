/**
 * Route shim — delegates to @stroupaloop/mission-control extensions.
 * @see src/extensions/fleet/api/slack-manifest.ts
 *
 * Const-binding form (vs `export { GET } from ...`) is intentional:
 * the api-contract-parity script greps for `export const GET =` /
 * `export function GET(`. A bare re-export wouldn't be picked up.
 */
import { GET as fleetSlackManifest } from '@/extensions/fleet/api/slack-manifest'

export const GET = fleetSlackManifest
