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
 * Default bot scopes for an MC-created agent.
 *
 * Aligned 2026-05-04 with the standard OpenClaw Slack-app shape
 * the operator's hand-crafted agents use (e.g. the
 * RAID/"Leverage Demo Agent" template). Beat 5e validation
 * surfaced that the prior narrower set caused
 * \`SlackMissingScope\` from \`conversations.list\` because the
 * channel picker requests both public AND private channel
 * types (the call requires \`channels:read\` + \`groups:read\`
 * together). Aligning the full scope set means new MC-created
 * agents match operator expectations out-of-the-box.
 *
 * What this enables:
 *   - public + private channel discovery (channels:read,
 *     groups:read)
 *   - read history in public + private + DMs + group DMs
 *     (channels:history, groups:history, im:history,
 *     mpim:history) — required for the agent to see prior
 *     context when replying to a thread
 *   - send messages, customized formatting, react with emoji
 *     (chat:write, chat:write.customize, reactions:write)
 *   - upload files in agent responses (files:write)
 *   - resolve user names for prompt context (users:read)
 *
 * NOT included (operator can extend post-creation if needed):
 *   - \`channels:join\` — agents are added to channels by
 *     operators manually, not self-invited.
 *   - \`commands\` (slash commands) — separate UX, file as
 *     needed.
 *   - \`app_mentions:read\` — implicit when subscribed to
 *     \`app_mention\` events; not needed in the OAuth scope
 *     set per Slack's docs.
 */
const DEFAULT_BOT_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'chat:write.customize',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'reactions:write',
  'users:read',
]

/**
 * Default bot events the agent subscribes to.
 *
 * Aligned 2026-05-04 with the standard OpenClaw Slack-app shape
 * — full-firehose subscription for every channel type the bot
 * is invited to. The operator's existing agents subscribe to
 * the full set; matching that means MC-created agents see the
 * same conversational context (a bot in a channel observes the
 * entire conversation, not just direct mentions).
 *
 *   - \`message.channels\` — public-channel messages
 *   - \`message.groups\` — private-channel messages
 *   - \`message.im\` — direct messages to the bot
 *   - \`message.mpim\` — multi-person DMs
 *
 * Cost note: every message in joined channels wakes up the
 * Socket Mode handler. Operators only invite the bot to
 * channels where they want it to engage, so the cost is
 * bounded by intentional channel membership. The earlier
 * "mention-only" default (PR #47 round-1) was over-conservative
 * for the standard OpenClaw use case where agents reason over
 * the whole channel context, not just @-mentions.
 *
 * NOT included by default:
 *   - \`app_mention\` — implicit in \`message.channels\` /
 *     \`message.groups\` (mentions ARE messages); subscribing
 *     separately doubles the wakeup count for the same event.
 */
const DEFAULT_BOT_EVENTS = [
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
]

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
