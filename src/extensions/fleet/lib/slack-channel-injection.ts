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
 *
 * #494: this count cap does NOT account for assignedUsers density —
 * a role-form payload with many assignedUsers per channel can hit
 * ECS_ENV_VALUE_MAX well below 50 channels. ECS_ENV_VALUE_MAX is the
 * real guard; the count cap is a coarse first gate.
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

/**
 * App-level cap on serialized OPENCLAW_SLACK_CONFIG_JSON length.
 * AWS ECS env values hard-cap much higher (~32 KiB); the
 * conservative app-level limit gives an operator-actionable 400
 * instead of a deep RegisterTaskDefinition failure.
 *
 * Round-1 audit on PR #57 (greptile P1, claude-bot P1): the
 * object-form payload (#291) is ~3× larger per channel
 * (`{"id":"C0123456789","requireMention":true}` ≈ 42 chars vs.
 * `"C0123456789"` ≈ 13 chars). At the prior 512-char cap the new
 * shape capped operators at ~11 channels — well below
 * MAX_CHANNELS_PER_AGENT=50, making the UI cap effectively dead
 * code. Raised to 4096 so 50 channels in object form fit with
 * headroom (50 × ~43 + 14 framing ≈ 2164 chars).
 */
export const ECS_ENV_VALUE_MAX = 4096

/**
 * Slack user-ID format: `U` + 8-12 uppercase alphanumerics.
 *
 * PARITY CONTRACT (ender-stack#494): this must match the
 * SLACK_USER_ID_RE that init-config.sh applies when it filters
 * `assignedUsers` and auto-injects AGENT_OWNER_SLACK_ID
 * (services/companion/openclaw/init/init-config.sh). MC is the
 * authoritative validator; init-config sanitizes defensively. If
 * one side's bound drifts, an operator can submit a user ID MC
 * accepts but init-config silently drops. Same dual-contract shape
 * as the IAM-coverage check — keep both ends in lock-step.
 *
 * templates/constraints.ts OWNER_SLACK_ID_RE shares this exact bound
 * (#494) so an owner accepted at create time is always one init-config
 * will inject — no silent owner-drop between create and channel-config.
 */
export const SLACK_USER_ID_RE = /^U[A-Z0-9]{8,12}$/

/**
 * Env var on the init-config container that carries the agent's
 * owner Slack ID (set by templates/openclaw.ts at create time).
 * init-config.sh auto-injects this into every primary channel's
 * assignedUsers, so a valid owner satisfies the primary-channel
 * assignment requirement even when the operator leaves
 * assignedUsers empty (#494).
 */
export const OWNER_SLACK_ID_ENV_NAME = 'AGENT_OWNER_SLACK_ID'

/**
 * Channel role taxonomy (ender-stack#378 / #494). Mirrors
 * VALID_ROLES in init-config.sh — the downstream consumer derives
 * requireMention + groupAllowFrom from these:
 *   primary — agent's home channel; ambient response to owner +
 *             assignedUsers (owner auto-injected downstream).
 *   active  — shared team channel; ambient for assignedUsers when
 *             accessMode='preferred', else mention-gated.
 *   monitor — mention-only presence; assignedUsers ignored.
 * Keep in lock-step with init-config.sh VALID_ROLES (parity contract).
 */
export const VALID_ROLES = ['primary', 'active', 'monitor'] as const
export type ChannelRole = (typeof VALID_ROLES)[number]

/** accessMode taxonomy — mirrors VALID_ACCESS_MODES in init-config.sh. */
export const VALID_ACCESS_MODES = ['exclusive', 'preferred'] as const
export type ChannelAccessMode = (typeof VALID_ACCESS_MODES)[number]

/**
 * Per-channel config (ender-stack#291, extended #494). Carries
 * reply-mode preference (legacy) and the role taxonomy that drives
 * groupAllowFrom enforcement downstream; the type is intentionally
 * extensible if OpenClaw surfaces more per-channel knobs.
 */
export interface ChannelConfig {
  id: string
  /**
   * If true (default): respond only on explicit @bot mentions
   * (matches OpenClaw's mention-gated default). If false:
   * respond to all messages in the channel.
   *
   * Legacy-only (#494): when `role` is present this is OMITTED from
   * the serialized payload — init-config.sh derives requireMention
   * from role(+accessMode), so emitting it here would carry an
   * ignored/contradictory value on the wire.
   */
  requireMention?: boolean
  /**
   * #494 role taxonomy. When present, init-config.sh derives
   * requireMention and enforces groupAllowFrom from assignedUsers.
   * Absent → legacy mention-gated mode (no allowlist gating).
   */
  role?: ChannelRole
  /**
   * Slack user IDs allowed to drive the agent in this channel
   * (→ groupAllowFrom downstream). Ignored for `monitor`. For
   * `primary`, the agent owner is auto-injected downstream.
   */
  assignedUsers?: string[]
  /** Only meaningful for `active` (flips requireMention to false). */
  accessMode?: ChannelAccessMode
}

/**
 * Caller-supplied channel reference. Accepts either the legacy
 * string-ID form (treated as `{id, requireMention: true}`) or
 * the new explicit object form. Both encode through serialize-
 * ChannelInputs into the same on-the-wire shape that
 * init-config.sh consumes (ender-stack#291).
 */
export type ChannelInput = string | ChannelConfig

/**
 * Normalize ChannelInput -> ChannelConfig with mention-gated
 * default. Strings become `{id, requireMention: true}` (the
 * OpenClaw default for safety; opt-in to always-reply).
 */
export function normalizeChannelInput(c: ChannelInput): ChannelConfig {
  if (typeof c === 'string') return { id: c, requireMention: true }
  // Legacy object form (no role) — preserve byte-identical pre-#494
  // output: {id, requireMention}. No role/assignedUsers/accessMode keys.
  if (typeof c.role !== 'string') {
    return {
      id: c.id,
      requireMention:
        typeof c.requireMention === 'boolean' ? c.requireMention : true,
    }
  }
  // Role-based form (#494). requireMention is derived downstream by
  // init-config.sh from role(+accessMode); omit it so the wire shape
  // carries no ignored value. Carry assignedUsers/accessMode only when
  // provided (JSON.stringify drops undefined → clean output).
  const out: ChannelConfig = { id: c.id, role: c.role }
  if (Array.isArray(c.assignedUsers)) out.assignedUsers = c.assignedUsers
  if (c.accessMode !== undefined) out.accessMode = c.accessMode
  return out
}

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

/**
 * Validate a list of ChannelInput entries (#291). Same per-item
 * format check as validateChannelIds, but accepts the object
 * form too; rejects malformed shapes (non-string id, non-boolean
 * requireMention).
 *
 * Validates the RAW (pre-dedup) request — every entry must be
 * individually well-formed. A stateless-invalid entry is rejected
 * even when a later duplicate for the same id would overwrite it
 * under serializeChannelInputs' last-object-wins dedup. This is
 * conservative-correct: rejecting a malformed payload is safer than
 * silently discarding the bad entry. (The owner-aware
 * validatePrimaryAssignment, by contrast, runs on the DEDUPED output
 * since it's about the channel that actually deploys.)
 */
export function validateChannelInputs(
  channels: ChannelInput[] | undefined,
): string | null {
  if (!channels || channels.length === 0) return null
  for (const c of channels) {
    if (typeof c === 'string') {
      if (!CHANNEL_ID_RE.test(c)) {
        return `Channel ID "${c.slice(0, 30)}" doesn't match Slack format ([CGD] + 8-12 alphanumerics)`
      }
      continue
    }
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') {
      return `Channel entry must be a string or { id, requireMention? } object`
    }
    if (!CHANNEL_ID_RE.test(c.id)) {
      return `Channel ID "${c.id.slice(0, 30)}" doesn't match Slack format ([CGD] + 8-12 alphanumerics)`
    }
    if (
      'requireMention' in c &&
      c.requireMention !== undefined &&
      typeof c.requireMention !== 'boolean'
    ) {
      return `Channel "${c.id}".requireMention must be a boolean if provided`
    }
    // #494: role / accessMode / assignedUsers shape + enum + format
    // checks. Mirrors init-config.sh's VALID_ROLES / VALID_ACCESS_MODES
    // / SLACK_USER_ID_RE so MC rejects upstream rather than letting
    // init-config silently sanitize. Fields are runtime-untrusted
    // (the request shape guard only verifies `id` is a string), so
    // guard defensively despite the ChannelConfig types.
    if ('role' in c && c.role !== undefined) {
      if (
        typeof c.role !== 'string' ||
        !VALID_ROLES.includes(c.role as ChannelRole)
      ) {
        return `Channel "${c.id}".role must be one of: ${VALID_ROLES.join(', ')}`
      }
    }
    if ('accessMode' in c && c.accessMode !== undefined) {
      if (
        typeof c.accessMode !== 'string' ||
        !VALID_ACCESS_MODES.includes(c.accessMode as ChannelAccessMode)
      ) {
        return `Channel "${c.id}".accessMode must be one of: ${VALID_ACCESS_MODES.join(', ')}`
      }
      // accessMode only changes behavior for role=active (it flips
      // requireMention). init-config.sh ignores it on primary/monitor
      // and logs a warning; reject upstream so the operator's intent
      // isn't silently dropped (MC is the authoritative validator).
      if (c.role !== 'active') {
        return `Channel "${c.id}".accessMode is only valid for role "active"`
      }
    }
    if ('assignedUsers' in c && c.assignedUsers !== undefined) {
      // assignedUsers only has meaning alongside a role (it becomes
      // groupAllowFrom downstream). Without a role, normalizeChannelInput
      // routes the entry down the legacy path and silently DROPS
      // assignedUsers — reject so the operator's allowlist intent isn't
      // swallowed with a misleading 200. Symmetric to the
      // accessMode-requires-active guard above.
      if (typeof c.role !== 'string') {
        return `Channel "${c.id}".assignedUsers requires a role (${VALID_ROLES.join(', ')})`
      }
      if (!Array.isArray(c.assignedUsers)) {
        return `Channel "${c.id}".assignedUsers must be an array of Slack user IDs`
      }
      for (const u of c.assignedUsers) {
        if (typeof u !== 'string' || !SLACK_USER_ID_RE.test(u)) {
          return `Channel "${c.id}".assignedUsers entry "${String(u).slice(0, 30)}" doesn't match Slack user-ID format (U + 8-12 alphanumerics)`
        }
      }
    }
  }
  return null
}

/**
 * Extract the agent's owner Slack ID from the init-config container's
 * AGENT_OWNER_SLACK_ID env var (#494). Returns the trimmed value only
 * if it matches SLACK_USER_ID_RE, else undefined. Used by the
 * owner-aware primary-channel assignment check below — the handlers
 * read this from the live task-def they already describe.
 */
export function extractOwnerSlackId(
  containers: ContainerDefinition[],
): string | undefined {
  const init = containers.find((c) => c.name === INIT_CONTAINER_NAME)
  const raw = init?.environment?.find(
    (e) => e.name === OWNER_SLACK_ID_ENV_NAME,
  )?.value
  const trimmed = raw?.trim()
  return trimmed && SLACK_USER_ID_RE.test(trimmed) ? trimmed : undefined
}

/**
 * Owner-aware validation for primary channels (#494). A `primary`
 * channel responds ambient (requireMention=false) and gates on
 * assignedUsers → groupAllowFrom. An empty allowlist with no owner
 * would degrade to mention-gated downstream (init-config safety
 * fallback) — surfacing that as a clear 400 here is better UX than a
 * silent degrade. Per the chosen policy: reject primary+empty ONLY
 * when the agent has no valid owner Slack ID; a valid owner satisfies
 * the requirement because init-config auto-injects it downstream.
 *
 * Runs AFTER the live task-def is described (that's where the owner
 * lives), so call it post-describe in the handlers, before the
 * RegisterTaskDefinition mutation.
 *
 * Multiple `primary` channels are permitted: init-config.sh's owner
 * auto-injection loops over EVERY channel with role==='primary' and
 * injects the owner into each, so there's no single-primary constraint
 * to enforce here — each primary is checked independently below.
 */
export function validatePrimaryAssignment(
  channels: ChannelInput[] | undefined,
  ownerSlackId: string | undefined,
): string | null {
  if (!channels || channels.length === 0) return null
  const hasValidOwner =
    typeof ownerSlackId === 'string' && SLACK_USER_ID_RE.test(ownerSlackId)
  if (hasValidOwner) return null
  for (const c of channels) {
    if (typeof c === 'string' || c.role !== 'primary') continue
    const assigned = Array.isArray(c.assignedUsers)
      ? c.assignedUsers.filter(
          (u) => typeof u === 'string' && SLACK_USER_ID_RE.test(u),
        )
      : []
    if (assigned.length === 0) {
      return `Channel "${c.id}" has role "primary" but no assignedUsers, and the agent has no usable owner Slack ID. Add at least one assigned user, or set the agent owner. (If an owner was set but its Slack ID isn't in the supported format — U + 8–12 alphanumerics — it's treated as unset.)`
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
 *
 * String-only legacy form. New code should use serializeChannelInputs
 * to round-trip per-channel requireMention (#291).
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

export interface SerializedChannelInputs {
  /** The JSON string written into OPENCLAW_SLACK_CONFIG_JSON. */
  json: string
  /** Deduped, normalized config objects (one per unique channel ID). */
  channels: ChannelConfig[]
}

/**
 * Dedupe + normalize + serialize the new ChannelInput list (#291).
 * Dedup keys on `id`. Resolution rules when the same id appears
 * more than once:
 *   - Object form always wins over string form (object carries
 *     explicit operator intent for requireMention; string is the
 *     mention-gated default).
 *   - Object + Object: last-writer-wins (operator's later choice
 *     overrides the earlier one — matches the in-memory Map
 *     semantics on the picker side and keeps the dedup
 *     deterministic).
 *
 * Round-1 audit on PR #57 (greptile P2, claude-bot P2): simplified
 * the skip clause — the prior `existing.requireMention !== undefined`
 * was always true since normalizeChannelInput sets it to a
 * concrete boolean.
 *
 * The on-the-wire shape is the legacy form for mention-gated entries
 *   {"channels":[{"id":"C123","requireMention":true},...]}
 * and the #494 role form for allowlist-gated entries
 *   {"channels":[{"id":"C123","role":"primary","assignedUsers":["U..."]},...]}
 * both of which init-config.sh's normalizeChannelInput accepts.
 */
export function serializeChannelInputs(
  rawChannels: ChannelInput[] | undefined,
): SerializedChannelInputs | { error: string } {
  const byId = new Map<string, ChannelConfig>()
  for (const c of rawChannels ?? []) {
    const normalized = normalizeChannelInput(c)
    // Skip a string entry when the id is already in the map —
    // the existing entry came from either an earlier string
    // (first-writer wins on string+string) or an earlier object
    // form (object wins). Object entries always overwrite.
    if (byId.has(normalized.id) && typeof c === 'string') {
      continue
    }
    byId.set(normalized.id, normalized)
  }
  const channels = [...byId.values()]
  const json = JSON.stringify({ channels })
  if (json.length > ECS_ENV_VALUE_MAX) {
    return {
      error: `channels JSON (${json.length} chars) exceeds the ${ECS_ENV_VALUE_MAX}-char ECS env-value limit. Reduce the channel count or the number of assignedUsers per channel.`,
    }
  }
  return { json, channels }
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
