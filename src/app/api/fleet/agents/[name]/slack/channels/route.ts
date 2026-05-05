/**
 * Route shim — delegates to @stroupaloop/mission-control extensions.
 * @see src/extensions/fleet/api/slack-channels.ts
 *
 * Const-binding form (vs `export { GET, PUT } from ...`) is intentional:
 * the api-contract-parity script greps for `export const GET =` /
 * `export function GET(`. Bare re-exports wouldn't be picked up.
 *
 * GET — list channels for the picker (Beat 5b.3).
 * PUT — channels-only update (#283).
 */
import {
  GET as fleetSlackChannels,
  PUT as fleetSlackChannelsPut,
} from '@/extensions/fleet/api/slack-channels'

export const GET = fleetSlackChannels
export const PUT = fleetSlackChannelsPut
