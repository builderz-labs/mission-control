/**
 * Route shim — delegates to @stroupaloop/mission-control extensions.
 * @see src/extensions/fleet/api/slack-channels.ts
 *
 * Const-binding form (vs `export { GET, PUT } from ...`) is intentional:
 * the api-contract-parity script greps for `export const GET =` /
 * `export function GET(`. Bare re-exports wouldn't be picked up.
 *
 * The PUT stub is a 501 placeholder for the channels-only update
 * path tracked as ender-stack#283. Round-2 audit on PR #51 moved
 * the implementation into the extension file (where auth lives) —
 * this shim is now consistent with GET.
 */
import {
  GET as fleetSlackChannels,
  PUT as fleetSlackChannelsPut,
} from '@/extensions/fleet/api/slack-channels'

export const GET = fleetSlackChannels
export const PUT = fleetSlackChannelsPut
