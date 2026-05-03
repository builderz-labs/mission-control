/**
 * Slack API wrapper — Phase 2.4 Beat 5b.3.
 *
 * Thin wrapper around the Slack `conversations.list` endpoint that:
 *   - Authenticates with a per-agent bot token (xoxb-…) read from
 *     Secrets Manager via `getSlackBotToken`.
 *   - Maps Slack's flat `{ ok: false, error: "..." }` envelope to
 *     named errors the channels handler can map to HTTP status
 *     codes.
 *   - Caps response size at one page (limit=100). Workspaces with
 *     more channels surface a `truncated: true` flag; the picker
 *     UI shows a "first 100 channels" notice. Pagination cursors
 *     can be wired in later if a real workspace hits the cap.
 *
 * Token-non-leak guarantee (round-2 audit on ender-stack#276): the
 * bot token is consumed exclusively as the Authorization header
 * value here and is never logged, returned, or surfaced in error
 * payloads. The caller (slack-channels.ts) MUST NOT pass error
 * messages from this module through to clients without sanitization
 * — Slack itself doesn't echo tokens in error bodies, but defense
 * in depth dictates the error mapping below stays opaque.
 */

const SLACK_API_BASE = 'https://slack.com/api'
const SLACK_LIST_LIMIT = 100
// 5s ceiling on the Slack call. Round-1 audit on PR #49: without
// this, a Slack outage would hang the API route worker until the
// platform-level TCP timeout fires (potentially minutes). The
// channel-picker UI is interactive — fail fast with
// SlackNetworkError so the operator sees a clear error and can
// retry rather than staring at a spinner.
const SLACK_FETCH_TIMEOUT_MS = 5_000

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
  numMembers?: number
}

export interface ListChannelsResult {
  channels: SlackChannel[]
  /** True if Slack returned a non-empty `next_cursor` and more pages exist. */
  truncated: boolean
}

interface SlackChannelRaw {
  id?: string
  name?: string
  is_private?: boolean
  num_members?: number
}

interface SlackConversationsListResponse {
  ok: boolean
  error?: string
  channels?: SlackChannelRaw[]
  response_metadata?: { next_cursor?: string }
}

/**
 * Call Slack `conversations.list` with the supplied bot token.
 *
 * Throws named errors mapped to specific Slack failure modes:
 *   - `SlackAuthError`: token is invalid or revoked. Operator
 *     should re-paste credentials.
 *   - `SlackMissingScope`: bot is missing `channels:read` /
 *     `groups:read`. Operator should reinstall the app from the
 *     manifest (which declares the scopes).
 *   - `SlackRateLimited`: HTTP 429 from Slack. Caller should map
 *     to 429 + Retry-After if available.
 *   - `SlackNetworkError`: fetch threw or response body wasn't
 *     parseable JSON.
 *   - `SlackUnknownError`: `ok: false` with an `error` we don't
 *     recognize. Surfaces the raw `error` code in `.message` for
 *     CloudWatch debugging (Slack error codes are public, not
 *     secret).
 */
export async function listChannels(
  botToken: string,
): Promise<ListChannelsResult> {
  const url = new URL(`${SLACK_API_BASE}/conversations.list`)
  url.searchParams.set('limit', String(SLACK_LIST_LIMIT))
  url.searchParams.set('types', 'public_channel,private_channel')
  url.searchParams.set('exclude_archived', 'true')

  let resp: Response
  try {
    resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${botToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS),
    })
  } catch (fetchErr) {
    // Round-1 audit on PR #49: do NOT embed `fetchErr.message`
    // in the SlackNetworkError message. The handler logs
    // `error.message` to CloudWatch, and a misbehaving fetch
    // implementation that echoes the Authorization header in
    // its error string would leak the bot token there. Use a
    // generic message — the SlackNetworkError class name + the
    // original fetch error's name (if any) is enough for
    // CloudWatch debugging without risking token material in
    // structured logs.
    const fetchErrName =
      (fetchErr as { name?: string })?.name ?? 'unknown'
    const e = new Error(
      `Slack conversations.list network error (cause=${fetchErrName}).`,
    )
    e.name = 'SlackNetworkError'
    throw e
  }

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('retry-after') ?? ''
    const e = new Error(
      `Slack rate-limited the conversations.list request (HTTP 429). Retry-After: ${retryAfter || 'unspecified'}.`,
    )
    e.name = 'SlackRateLimited'
    Object.assign(e, { retryAfter })
    throw e
  }

  if (!resp.ok) {
    const e = new Error(
      `Slack conversations.list returned HTTP ${resp.status}.`,
    )
    e.name = 'SlackNetworkError'
    throw e
  }

  let body: SlackConversationsListResponse
  try {
    body = (await resp.json()) as SlackConversationsListResponse
  } catch {
    const e = new Error(
      'Slack conversations.list returned a non-JSON body.',
    )
    e.name = 'SlackNetworkError'
    throw e
  }

  if (!body.ok) {
    const slackErr = body.error ?? 'unknown_error'
    if (
      slackErr === 'invalid_auth' ||
      slackErr === 'token_revoked' ||
      slackErr === 'not_authed' ||
      slackErr === 'token_expired'
    ) {
      // Round-5 audit on PR #49: added `token_expired` to the
      // SlackAuthError cluster. Same remediation as the other
      // three (operator re-pastes credentials), so it should
      // surface the same actionable hint instead of falling
      // through to the opaque SlackUnknownError.
      const e = new Error(
        `Slack rejected the bot token (${slackErr}). Operator should re-paste credentials.`,
      )
      e.name = 'SlackAuthError'
      throw e
    }
    if (slackErr === 'missing_scope') {
      const e = new Error(
        'Slack rejected the call for missing scope (need channels:read + groups:read). Operator should reinstall the app from the manifest.',
      )
      e.name = 'SlackMissingScope'
      throw e
    }
    if (slackErr === 'account_inactive' || slackErr === 'app_inactive') {
      // Round-4 audit on PR #49: workspace-level disabled state
      // (Slack plan suspended, app deleted from workspace).
      // Re-pasting credentials WON'T fix this; the operator
      // needs to take action in api.slack.com/apps directly. The
      // distinct error class lets the UI render a different
      // remediation hint.
      const e = new Error(
        `Slack workspace or app is inactive (${slackErr}). The Slack workspace's plan may be suspended, or the app was deleted from the workspace. Resolve in api.slack.com/apps before re-pasting credentials.`,
      )
      e.name = 'SlackAccountInactive'
      throw e
    }
    const e = new Error(`Slack returned ok:false with error="${slackErr}".`)
    e.name = 'SlackUnknownError'
    throw e
  }

  const channels: SlackChannel[] = (body.channels ?? [])
    .filter(
      (c): c is SlackChannelRaw & { id: string; name: string } =>
        typeof c.id === 'string' && typeof c.name === 'string',
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private === true,
      ...(typeof c.num_members === 'number'
        ? { numMembers: c.num_members }
        : {}),
    }))

  const truncated =
    typeof body.response_metadata?.next_cursor === 'string' &&
    body.response_metadata.next_cursor.length > 0

  return { channels, truncated }
}
