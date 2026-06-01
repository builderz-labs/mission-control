/**
 * Route shim — delegates to @stroupaloop/mission-control extensions.
 * @see src/extensions/fleet/api/bulk-redeploy.ts
 *
 * Const-binding form (vs `export { POST } from ...`) is intentional: the
 * api-contract-parity script greps for `export const POST =` /
 * `export function POST(`. A bare re-export wouldn't be picked up.
 */
import { POST as fleetBulkRedeployPost } from '@/extensions/fleet/api/bulk-redeploy'

export const POST = fleetBulkRedeployPost
