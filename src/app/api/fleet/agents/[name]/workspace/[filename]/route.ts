/**
 * Route shim — delegates to @stroupaloop/mission-control extensions.
 * @see src/extensions/fleet/api/workspace.ts
 *
 * Const-binding form (vs `export { GET, PUT } from ...`) is intentional:
 * the api-contract-parity script greps for `export const GET =` /
 * `export function GET(`. Bare re-exports wouldn't be picked up.
 *
 * GET — read a seeded persona file + its hash (#377).
 * PUT — write a persona file with If-Match optimistic concurrency (#377).
 */
import {
  GET as fleetWorkspaceGet,
  PUT as fleetWorkspacePut,
} from '@/extensions/fleet/api/workspace'

export const GET = fleetWorkspaceGet
export const PUT = fleetWorkspacePut
