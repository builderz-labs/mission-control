/**
 * Per-harness deploy template registry.
 *
 * Each harness type (companion/openclaw today; task/hermes when the
 * Hermes-Phase PR lands) gets a renderer module that emits the AWS
 * SDK input objects for RegisterTaskDefinition / CreateService /
 * CreateTargetGroup / CreateRule. The create-agent handler dispatches
 * by `harnessType` to the matching renderer; everything specific to a
 * harness (port, healthcheck path, env vars, cpu/memory defaults) lives
 * in its renderer file, NOT in the handler.
 *
 * Adding a harness:
 *   1. Author `templates/{harness}.ts` with the same renderer signatures
 *      as openclaw.ts (renderTaskDefinition, renderTargetGroup, renderService,
 *      renderListenerRule for ALB-attached harnesses; omit the ALB calls
 *      for ephemeral / RunTask harnesses).
 *   2. Register it in HARNESS_TEMPLATES below.
 *   3. Add a case to the form's harness-type select.
 *   4. Confirm modules/iam/main.tf's task_ecs_write doc covers the
 *      new naming pattern (currently scoped to `companion-*`; Hermes
 *      will need `worker-*` when its architecture decision lands).
 */

import * as openclaw from './openclaw'
import {
  AGENT_NAME_RE,
  DISPLAY_NAME_MAX_BYTES,
  EMOJI_MAX_BYTES,
  HARNESS_TYPES,
  IMAGE_MAX_BYTES,
  PERSONA_FIELD_CONTROL_CHAR_RE,
  PERSONA_FIELD_DISALLOWED_PREFIX_RE,
  PERSONA_MAX_BYTES,
  ROLE_DESCRIPTION_MAX_BYTES,
  type HarnessType,
} from './constraints'

// Re-export for callers that already imported from this module.
// Constants live in `./constraints` (no AWS SDK imports) so client
// components can pull them without dragging the AWS SDK into the browser
// bundle. See constraints.ts for the security-control commentary.
export { HARNESS_TYPES, type HarnessType }

/**
 * Concrete shape today (OpenClaw only). Generics removed until a second
 * harness lands — adding `<I, E>` while every render method is bound to
 * `typeof openclaw.*` was a false-extensibility signal that would have
 * needed a real generalization pass on the first Hermes/etc. PR anyway.
 * The right time to re-add the generics is when we have ≥2 input/env
 * shapes to vary over.
 */
export interface HarnessTemplate {
  renderTaskDefinition: typeof openclaw.renderTaskDefinition
  renderTargetGroup: typeof openclaw.renderTargetGroup
  renderService: typeof openclaw.renderService
  renderListenerRule: typeof openclaw.renderListenerRule
  /**
   * Validates the harness-specific shape of the form input. Throws on
   * invalid.
   *
   * `prefix` is optional for backward compatibility with callers that
   * only have the input (e.g. unit tests asserting input-only
   * constraints). When provided, the validator also enforces
   * deployment-aware constraints — for OpenClaw, that's the
   * `${prefix}-agent-${name}` target-group-name length cap (AWS 32
   * char limit). The handler always passes prefix; tests for
   * input-only invariants can omit it.
   */
  validateInput: (input: openclaw.OpenClawAgentInput, prefix?: string) => void
}

// Image registry allowlist. Defaults to ECR-in-this-account, GHCR
// under stroupaloop, and AWS public ECR — everything we expect a
// legitimate operator to reference. The image tag in a task-def
// revision is permanent and admin-creatable; without an allowlist,
// a compromised admin token could deploy from `docker.io/anyone/*`
// (or any other registry the execution role can reach via its
// ECR pull permissions). Defense at the API layer.
//
// Override via MC_FLEET_IMAGE_REGISTRY_ALLOWLIST — comma-separated
// regex prefixes. When unset, the conservative default below applies.
// Each entry is matched as a prefix (anchored implicitly at start of
// the image string), not a substring, so e.g. `ghcr.io/stroupaloop`
// permits `ghcr.io/stroupaloop/openclaw:tag` but NOT
// `evil.com/ghcr.io/stroupaloop`.
const DEFAULT_IMAGE_REGISTRY_PREFIXES = [
  String.raw`[0-9]+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/`,
  String.raw`ghcr\.io/stroupaloop/`,
  String.raw`public\.ecr\.aws/`,
]

/**
 * Thrown when MC_FLEET_IMAGE_REGISTRY_ALLOWLIST contains a malformed
 * regex pattern. Surfaced separately from generic validation errors so
 * the handler can map it to a clear configuration error rather than a
 * confusing 502 SyntaxError. Caught upstream in api/agents.ts and
 * mapped to the same ConfigurationError shape used for missing env
 * vars (admin-only endpoint; the message safely identifies which
 * pattern failed to compile).
 */
export class ImageAllowlistConfigError extends Error {
  readonly badPattern: string
  constructor(badPattern: string, cause: Error) {
    super(
      `MC_FLEET_IMAGE_REGISTRY_ALLOWLIST entry is not a valid regex: ${JSON.stringify(badPattern)} (${cause.message})`,
    )
    this.name = 'ImageAllowlistConfigError'
    this.badPattern = badPattern
  }
}

function imageRegistryAllowlist(): RegExp[] {
  const env = process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST
  const prefixes = env
    ? env.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_IMAGE_REGISTRY_PREFIXES
  return prefixes.map((p) => {
    try {
      return new RegExp(`^${p}`)
    } catch (err) {
      throw new ImageAllowlistConfigError(p, err as Error)
    }
  })
}

function validateOpenClawInput(
  input: openclaw.OpenClawAgentInput,
  prefix?: string,
): void {
  if (!AGENT_NAME_RE.test(input.agentName)) {
    throw new Error(
      `agentName must match ${AGENT_NAME_RE}; got ${JSON.stringify(input.agentName)}`,
    )
  }
  // Combined target-group-name length cap (AWS 32-char limit on
  // ELBv2 target group names). Only enforced when prefix is provided
  // — handlers always pass it; input-only unit tests can omit it.
  // Round-3b.2 round-2 audit moved this from the handler-only
  // pre-check into validateInput for layering symmetry with the
  // other input constraints.
  if (typeof prefix === 'string') {
    const tgName = openclaw.targetGroupName(prefix, input.agentName)
    if (tgName.length > openclaw.TARGET_GROUP_NAME_MAX_LENGTH) {
      const maxName = openclaw.maxAgentNameLengthForPrefix(prefix)
      throw new Error(
        `agentName too long for this deployment: target group name "${tgName}" ` +
          `is ${tgName.length} chars, AWS limit is ${openclaw.TARGET_GROUP_NAME_MAX_LENGTH}. ` +
          `Max agentName length here is ${maxName}.`,
      )
    }
  }
  // Image must contain a tag/digest separator AND have something after
  // it. `img:` (empty tag) passes a naive includes(':') check but ECS
  // rejects it as InvalidParameterException at RegisterTaskDefinition,
  // surfacing as a confusing 502 to the operator. Mirror the client-
  // side `lastTagSegment.length > 0` check (panels/create-agent-form.tsx)
  // here so a direct POST that bypasses the form gets the same clean
  // 400 ValidationError instead of an opaque AWS-layer 502. Round-9
  // audit on PR #37.
  if (
    !input.image ||
    !input.image.includes(':') ||
    !(input.image.split(':').at(-1) ?? '')
  ) {
    throw new Error(
      'image must be a fully-qualified container ref with a non-empty tag or digest',
    )
  }
  // UTF-8 byte count, not String.prototype.length (which counts UTF-16
  // code units). Without this, a 16-char composed-emoji `emoji` field
  // passes (`.length === 16 ≤ 16`) but encodes to ~64 UTF-8 bytes —
  // 4x the documented cap. The client (`create-agent-form.tsx`) uses
  // TextEncoder for the same reason; the server boundary must match
  // or init-config's defensive truncate silently fires and the
  // operator-supplied value is mangled. Claude bot R2 medium on PR #69.
  const utf8Bytes = (s: string) => Buffer.byteLength(s, 'utf8')

  const imageBytes = utf8Bytes(input.image)
  if (imageBytes > IMAGE_MAX_BYTES) {
    throw new Error(
      `image must be ≤ ${IMAGE_MAX_BYTES} bytes; got ${imageBytes}`,
    )
  }
  const allowlist = imageRegistryAllowlist()
  if (!allowlist.some((re) => re.test(input.image))) {
    throw new Error(
      `image registry not in allowlist; got ${JSON.stringify(input.image)}. ` +
        `Set MC_FLEET_IMAGE_REGISTRY_ALLOWLIST (comma-separated regex prefixes) to override the default.`,
    )
  }
  if (!input.roleDescription.trim()) {
    throw new Error('roleDescription is required')
  }
  const roleDescriptionBytes = utf8Bytes(input.roleDescription)
  if (roleDescriptionBytes > ROLE_DESCRIPTION_MAX_BYTES) {
    throw new Error(
      `roleDescription must be ≤ ${ROLE_DESCRIPTION_MAX_BYTES} bytes; got ${roleDescriptionBytes}`,
    )
  }
  // roleDescription is rendered as a multi-line textarea in the form
  // (pre-Phase-2 behavior preserved); the resulting AGENT_ROLE env var
  // is normalized to single-line by ender-stack init-config's
  // `normField` (CR/LF/U+2028/U+2029 → single space) before substitution
  // into IDENTITY.md. So roleDescription tolerates LF/tab the same way
  // persona does (multi-line prose acceptable); only non-LF/non-tab
  // control chars are rejected.
  //
  // The single-line-only `validatePersonaField` is reserved for
  // displayName / emoji where the values land in IDENTITY.md without
  // intermediate normalization that would collapse paragraph breaks.
  // Claude bot R4 bug finding on PR #69: applying the strict
  // single-line check to roleDescription regressed pre-Phase-2
  // multi-line textarea support.
  validateProseField('roleDescription', input.roleDescription)

  // #357 Phase-2: optional persona fields. displayName / emoji apply
  // the single-line guard (validatePersonaField — list-item prefix +
  // ALL control chars). persona uses the multi-line prose guard
  // (validateProseField — control chars except LF / tab).
  if (input.displayName !== undefined) {
    const displayNameBytes = utf8Bytes(input.displayName)
    if (displayNameBytes > DISPLAY_NAME_MAX_BYTES) {
      throw new Error(
        `displayName must be ≤ ${DISPLAY_NAME_MAX_BYTES} bytes; got ${displayNameBytes}`,
      )
    }
    if (input.displayName) validatePersonaField('displayName', input.displayName)
  }
  if (input.emoji !== undefined) {
    const emojiBytes = utf8Bytes(input.emoji)
    if (emojiBytes > EMOJI_MAX_BYTES) {
      throw new Error(
        `emoji must be ≤ ${EMOJI_MAX_BYTES} bytes; got ${emojiBytes}`,
      )
    }
    if (input.emoji) validatePersonaField('emoji', input.emoji)
  }
  if (input.persona !== undefined) {
    const personaBytes = utf8Bytes(input.persona)
    if (personaBytes > PERSONA_MAX_BYTES) {
      throw new Error(
        `persona must be ≤ ${PERSONA_MAX_BYTES} bytes; got ${personaBytes}`,
      )
    }
    if (input.persona) validateProseField('persona', input.persona)
  }
}

/**
 * Multi-line prose validator (roleDescription + persona). Rejects
 * disallowed control chars but ALLOWS LF and tab — operators
 * legitimately want paragraph breaks. Markdown is legitimate too;
 * no list-item-prefix check (init-config strips H1-H6 from persona
 * defensively at the boot boundary).
 */
function validateProseField(name: string, value: string): void {
  if (!PERSONA_FIELD_CONTROL_CHAR_RE.test(value)) return
  const stripped = value.replace(/[\n\t]/g, '')
  if (PERSONA_FIELD_CONTROL_CHAR_RE.test(stripped)) {
    throw new Error(`${name} contains disallowed control characters`)
  }
}

/**
 * Shared check for displayName / emoji — short single-line fields
 * that land in IDENTITY.md as markdown bullet content. Rejects
 * control chars and `^- `/`^* ` list-item prefixes that would inject
 * net-new trusted bullets into the agent's IDENTITY.md.
 *
 * NOT used for roleDescription — that field uses validateProseField
 * (multi-line allowed via textarea, init-config normField collapses
 * line breaks at the boot boundary).
 */
function validatePersonaField(name: string, value: string): void {
  if (PERSONA_FIELD_CONTROL_CHAR_RE.test(value)) {
    throw new Error(`${name} contains disallowed control characters`)
  }
  // Check the trimmed value — the template emits trimmed values to
  // the task-def, so leading whitespace before a list-item prefix
  // would otherwise bypass this check but land as a structural-look-
  // alike after the emit-side trim. Claude bot R5 low on PR #69.
  if (PERSONA_FIELD_DISALLOWED_PREFIX_RE.test(value.trim())) {
    throw new Error(
      `${name} cannot start with a markdown list-item prefix ` +
        `('- ' or '* '); use plain text. (#357 Phase-2 / #360 Item 1)`,
    )
  }
}

export const HARNESS_TEMPLATES: Record<HarnessType, HarnessTemplate> = {
  'companion/openclaw': {
    renderTaskDefinition: openclaw.renderTaskDefinition,
    renderTargetGroup: openclaw.renderTargetGroup,
    renderService: openclaw.renderService,
    renderListenerRule: openclaw.renderListenerRule,
    validateInput: validateOpenClawInput,
  },
}

export type {
  OpenClawAgentInput,
  OpenClawAgentEnv,
  AgentListenerRuleSpec,
} from './openclaw'
