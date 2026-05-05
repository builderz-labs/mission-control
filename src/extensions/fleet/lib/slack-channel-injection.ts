/**
 * Slack channel-config injection helpers — Phase 2.4 Beat 5b.2 + #283.
 *
 * Shared between two handlers that both need to validate +
 * serialize a channel-ID list and inject it onto the agent's
 * init-config container env block:
 *
 *   - POST /api/fleet/agents/{name}/slack/credentials
 *     — paste-flow that writes 3 secrets + sets channels at the
 *     same time. Originally housed all this logic inline.
 *   - PUT  /api/fleet/agents/{name}/slack/channels (#283)
 *     — channels-only update. Reads the live task-def, mutates
 *     the init container's env, registers a new revision.
 *     Doesn't touch SM secrets (they're already wired by the
 *     prior credentials POST).
 *
 * Extracted out of slack-credentials.ts on #283 so the two
 * handlers can't drift on validation rules or ECS-env size
 * limits. Comments preserved verbatim from the prior inline
 * site so the audit history (rounds 1-8 on PR #48) stays
 * traceable.
 */

import type { ContainerDefinition } from '@aws-sdk/client-ecs'

/** Init container name in the OpenClaw task-def template. */
export const INIT_CONTAINER_NAME = 'init-config'

/** Env var name the init-config script reads to template openclaw.json. */
export const SLACK_CONFIG_ENV_NAME = 'OPENCLAW_SLACK_CONFIG_JSON'

/**
 * Maximum number of channels per agent paste. ECS task-def env
 * values cap at 512 chars; with the JSON framing overhead
 * (`{"channels":["C0XXXXXX","C0YYYYYY",...]}`), ~50 channel IDs
 * is the practical ceiling before RegisterTaskDefinition starts
 * 502'ing. Cap at the application layer with a clear 400 so the
 * operator gets an actionable error instead of a cryptic AWS
 * failure. Round-1 audit on PR #48.
 */
export const MAX_CHANNELS_PER_AGENT = 50

/**
 * Slack channel ID format: `C[A-Z0-9]{8,10}` for public channels,
 * `G[A-Z0-9]{8,10}` for private groups, `D[A-Z0-9]{8,10}` for DMs.
 * 9-13 chars total. The picker only surfaces public + private
 * (DMs aren't useful to subscribe to as a channel-list entry).
 *
 * Uppercase-only assumption (round-1 audit on PR #55, claude-bot):
 * Slack returns all-uppercase channel IDs in the conversations.list
 * v2 response. If a future workspace API ever returns lowercase
 * IDs, the picker would display them but PUT /channels would
 * reject them on Save — a confusing UX failure with no operator
 * action. If that happens, broaden to `[A-Za-z0-9]` here and
 * mirror the change in the openapi.json `pattern`.
 */
export const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,12}$/

/** ECS task-def env-value cap. */
export const ECS_ENV_VALUE_MAX = 512

/**
 * Validate every channel ID matches the Slack format. Returns
 * a human-readable error message if any item fails, or null if
 * the list is acceptable. Round-2 audit on PR #48: per-item
 * check beyond the count cap so a single 100-char gibberish
 * string can't push OPENCLAW_SLACK_CONFIG_JSON past the
 * 512-char ECS env-value cap even with the 50-item count-cap
 * in place.
 *
 * Returns string for compatibility with the credentials POST
 * handler's existing response shape; PUT /channels handler
 * wraps the same string into its own response.
 */
export function validateChannelIds(
  channels: string[] | undefined,
): string | null {
  if (!channels || channels.length === 0) return null
  for (const c of channels) {
    if (!CHANNEL_ID_RE.test(c)) {
      return `Channel ID "${c.slice(0, 30)}" doesn't match Slack format ([CGD] + 8-12 alphanumerics)`
    }
  }
  return null
}

export interface SerializedChannels {
  /** The JSON string written into OPENCLAW_SLACK_CONFIG_JSON. */
  json: string
  /** The deduped channel array (Set-preserved first-occurrence order). */
  channels: string[]
}

/**
 * Dedupe + serialize the channel list into the JSON shape
 * init-config.sh consumes. Round-8 audit on PR #48: Set-based
 * dedupe to prevent ['C012', 'C012'] from causing the OpenClaw
 * Slack plugin to subscribe twice and double-deliver each event.
 *
 * Returns the serialized object on success, or a string error
 * message if the serialized form exceeds ECS_ENV_VALUE_MAX
 * (catches the case where 40+ valid-shape 13-char IDs serialize
 * past 512 chars even with the count + format checks in place).
 */
export function serializeChannels(
  rawChannels: string[] | undefined,
): SerializedChannels | { error: string } {
  const dedupedChannels = [...new Set(rawChannels ?? [])]
  const json = JSON.stringify({ channels: dedupedChannels })
  if (json.length > ECS_ENV_VALUE_MAX) {
    return {
      error: `channels JSON (${json.length} chars) exceeds the ${ECS_ENV_VALUE_MAX}-char ECS env-value limit. Reduce the channel count.`,
    }
  }
  return { json, channels: dedupedChannels }
}

/**
 * Mutate the init-config container in-place: push
 * OPENCLAW_SLACK_CONFIG_JSON onto the env block.
 *
 * ender-stack#286: this used to live alongside the secrets
 * injection on the gateway container — wrong target.
 * init-config.sh (Beat 5d) reads OPENCLAW_SLACK_CONFIG_JSON to
 * template openclaw.json into the EFS config mount; the
 * gateway then reads the rendered file. The init container is
 * the consumer.
 *
 * Defensive on the env block: if OPENCLAW_SLACK_CONFIG_JSON
 * already exists (operator re-paste with new channels),
 * replace its value rather than duplicate. ECS rejects
 * task-defs with duplicate env var names.
 *
 * Throws TaskDefinitionInitMissing if no container named
 * `init-config` is present — non-retriable; same operator
 * action as gateway-missing.
 */
export function injectChannelsIntoInit(
  containers: ContainerDefinition[],
  channelsConfigJson: string,
): ContainerDefinition[] {
  const hasInit = containers.some((c) => c.name === INIT_CONTAINER_NAME)
  if (!hasInit) {
    const err = new Error(
      `Task-def has no '${INIT_CONTAINER_NAME}' container — cannot inject Slack channel config. ` +
        `Found containers: [${containers.map((c) => c.name).join(', ')}]. ` +
        `Non-retriable: check container names in templates/openclaw.ts vs. the registered task-def.`,
    )
    err.name = 'TaskDefinitionInitMissing'
    throw err
  }
  return containers.map((c) => {
    if (c.name !== INIT_CONTAINER_NAME) return c
    const existingEnv = (c.environment ?? []).filter(
      (e) => e.name !== SLACK_CONFIG_ENV_NAME,
    )
    const newEnv = [
      ...existingEnv,
      { name: SLACK_CONFIG_ENV_NAME, value: channelsConfigJson },
    ]
    return {
      ...c,
      environment: newEnv,
    }
  })
}
