/**
 * Slack app manifest template — Phase 2.4 Beat 5b.1.
 *
 * Generates the JSON the operator pastes into api.slack.com/apps
 * "Create New App → From Manifest" when wiring an MC-created agent
 * to a Slack workspace.
 *
 * **Socket Mode is the architectural decision.** The manifest enables
 * Socket Mode (`settings.socket_mode_enabled: true`) and OMITS all
 * `request_url` fields (event subscriptions, interactivity, slash
 * commands). With Socket Mode, the agent opens an OUTBOUND WebSocket
 * to Slack and receives events down the socket — no public ingress
 * needed for the agent's ALB. This eliminates the entire architectural
 * gap of "internal ALB can't receive Slack webhooks." See plan file.
 *
 * The operator gets THREE tokens after creating + installing the app:
 *   - app-level token (xapp-...) for the WebSocket connection
 *     (requires `connections:write` scope, generated separately
 *     under "Basic Information → App-Level Tokens")
 *   - bot token (xoxb-...) for sending messages back
 *   - signing secret (used for optional event-signing — Socket Mode
 *     bypasses signature verification, but kept for defense in depth
 *     if the operator ever flips the app to Events API mode)
 *
 * The instructions surfaced in the UI must spell out the
 * "enable Socket Mode + generate App-Level Token" step explicitly —
 * it's NOT something Slack's "Create from manifest" flow does
 * automatically (the app is created with Socket Mode flag set, but
 * the operator still has to click into "Socket Mode" sidebar +
 * generate the App-Level Token).
 */

/**
 * Slack manifest schema (subset). Slack's full schema includes
 * shortcuts, slash commands, app home, etc — Phase-2.4 only needs
 * the bot-user + event-subscriptions surface. Extending this
 * type as Phase-2.5+ adds richer Slack interactions is the
 * intended path.
 *
 * Reference: https://api.slack.com/reference/manifests
 */
export interface SlackAppManifest {
  /** Manifest schema version — Slack uses 1.1 currently. */
  _metadata: {
    major_version: number
    minor_version: number
  }
  display_information: {
    name: string
    description: string
    background_color?: string
  }
  features: {
    bot_user: {
      display_name: string
      always_online: boolean
    }
  }
  oauth_config: {
    scopes: {
      bot: string[]
    }
  }
  settings: {
    event_subscriptions: {
      // `request_url?: never` is the compile-time guard against
      // accidentally re-introducing public ingress dependency. The
      // serialization-level test (in slack-manifest.test.ts) catches
      // the same regression at runtime; the type-level constraint
      // catches it at PR-time so reviewers see the conflict in the
      // diff. Round-3 audit on PR #47.
      bot_events: string[]
      request_url?: never
    }
    interactivity: {
      is_enabled: boolean
      request_url?: never
    }
    org_deploy_enabled: boolean
    socket_mode_enabled: boolean
    token_rotation_enabled: boolean
  }
}

export interface SlackManifestInput {
  /** Agent name — appears as the Slack app name + bot display name. */
  agentName: string
  /** Operator-supplied role description — shown as the Slack app description. */
  roleDescription: string
}

/**
 * Default bot scopes for an MC-created agent. Covers the minimum
 * needed to (a) be mentioned, (b) read channel history when
 * mentioned, (c) reply in-thread, (d) handle direct messages, and
 * (e) resolve user names for prompt context.
 *
 * NOT included (operator can extend post-creation if needed):
 *   - `channels:join` — agents are added to channels by operators
 *     manually, not self-invited.
 *   - `groups:*` (private channel scopes) — opt-in per workspace.
 *   - `files:*` (file uploads) — Phase-2.5+ if needed.
 *   - `commands` (slash commands) — separate UX, file as needed.
 */
const DEFAULT_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'im:history',
  'im:read',
  'im:write',
  'users:read',
]

/**
 * Default bot events the agent subscribes to. Intentionally small —
 * each event wakes up the Socket Mode WebSocket handler. Agents
 * that subscribe to firehose-shaped events generate a lot of noise
 * + cost (every message in every joined channel is a wakeup, even
 * if the agent doesn't engage).
 *
 * Today's set is mention-driven only (round-1 audit on PR #47
 * trimmed `message.channels` from the default — operators can
 * add it via Slack's app-config UI post-creation if they want
 * firehose-style engagement, but defaulting OFF avoids accidental
 * cost surprise on workspaces with high traffic):
 *
 *   - `app_mention` — primary trigger (someone @-mentions the agent)
 *   - `message.im` — direct messages to the bot (always relevant)
 *
 * NOT included by default:
 *   - `message.channels` — every channel message; high-volume.
 *     Document in operator instructions as the "subscribe more"
 *     path if/when an agent needs broader context.
 */
const DEFAULT_BOT_EVENTS = ['app_mention', 'message.im']

/**
 * Render a Slack app manifest for the given agent. Pure function —
 * no side effects, no env reads. The output is JSON-serializable
 * for direct paste into api.slack.com/apps.
 */
export function renderSlackManifest(
  input: SlackManifestInput,
): SlackAppManifest {
  return {
    _metadata: {
      major_version: 1,
      minor_version: 1,
    },
    display_information: {
      name: input.agentName,
      description: truncateForSlack(input.roleDescription, 140),
    },
    features: {
      bot_user: {
        display_name: input.agentName,
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: [...DEFAULT_BOT_SCOPES],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [...DEFAULT_BOT_EVENTS],
      },
      interactivity: {
        is_enabled: true,
      },
      // Org-deploy is for Slack Enterprise Grid; default off for
      // standard workspace installs.
      org_deploy_enabled: false,
      // The architectural unlock — agent connects OUT to Slack via
      // WebSocket. No public ingress required.
      socket_mode_enabled: true,
      // Slack's optional auto-rotation for OAuth tokens. Leaving
      // disabled today — Phase-2.4 expects manual paste; rotation
      // is its own re-paste flow. Operators can enable post-create
      // if they want.
      token_rotation_enabled: false,
    },
  }
}

/**
 * Slack imposes max-length on display_information.description (140
 * chars per the manifest schema). Operator-supplied role descriptions
 * can exceed that — truncate so the manifest is always Slack-valid
 * rather than failing schema validation at paste time.
 *
 * Codepoint-aware (round-2 audit on PR #47): `String.prototype.slice`
 * operates on UTF-16 code units, so cutting at `maxLength - 1` could
 * split a surrogate pair (emoji, some CJK extension blocks) and
 * produce invalid UTF-16. `Array.from(text)` splits by Unicode
 * codepoint; rejoining is safe.
 */
function truncateForSlack(text: string, maxLength: number): string {
  const codePoints = Array.from(text)
  if (codePoints.length <= maxLength) return text
  // Reserve 1 codepoint for the truncation marker.
  return codePoints.slice(0, maxLength - 1).join('') + '…'
}
