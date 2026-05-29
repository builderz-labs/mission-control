/**
 * Shared input constraints for the create-agent flow.
 *
 * Lives in a separate file (no AWS SDK imports) so the constants are
 * safe to import from client components — pulling them through
 * templates/index.ts or templates/openclaw.ts would drag the AWS SDK
 * into the browser bundle. The Fleet panel's create-agent form
 * imports directly from this module.
 *
 * Server-side validation lives in:
 *   - templates/index.ts (validateOpenClawInput) — per-harness defense.
 *   - api/agents.ts (isCreateAgentRequest) — harness-agnostic type guard.
 *
 * Both server-side validators reuse the constants below — the regex
 * literal in particular is load-bearing as a security control (see the
 * IAM ARN-pattern note in api/agents.ts and the `task_ecs_write`
 * IAM grant in ender-stack/terraform/modules/iam/main.tf).
 */

export const HARNESS_TYPES = ['companion/openclaw'] as const
export type HarnessType = (typeof HARNESS_TYPES)[number]

/**
 * Minimum allowed agentName length. Encoded structurally in
 * AGENT_NAME_RE (1 start + 1 middle + 1 end = 3 chars min), but
 * exported separately so callers comparing against the cap (e.g.
 * harness-defaults's degenerate-prefix gate) don't have to reverse-
 * engineer it from the regex literal. Round-4 audit on PR #39
 * caught the off-by-two when the gate compared against 0 instead of
 * the regex min.
 */
export const AGENT_NAME_MIN_LENGTH = 3

/**
 * Maximum allowed agentName length. Mirrors the upper bound encoded
 * in AGENT_NAME_RE's `{1,18}` middle window (1 start + 18 middle + 1
 * end = 20 chars). Exported as a separate constant so callers
 * surfacing the limit to operators (error messages, future CLI help
 * text, UI validation) don't have to reverse-engineer it from the
 * regex literal — same posture as AGENT_NAME_MIN_LENGTH. The IAM
 * role-name 64-char budget is the load-bearing reason this is 20;
 * see the AGENT_NAME_RE docblock below for the prefix math.
 */
export const AGENT_NAME_MAX_LENGTH = 20

/**
 * agentName must:
 * - start with an alphanumeric (no leading hyphen — ELBv2 + ECS
 *   reject names with leading hyphens).
 * - contain only [a-z0-9-] in the middle.
 * - end with an alphanumeric (no trailing hyphens — same reason).
 * - be 3-20 chars total (the {1,18} middle window plus start + end
 *   anchors). Combined-name caps (`{prefix}-agent-{name}` ≤ 32 for
 *   target groups) are enforced separately by validateOpenClawInput.
 *
 * The 20-char ceiling is the load-bearing constraint for the
 * per-agent IAM role-name budget (#134). The combined role name
 * `${prefix}-companion-openclaw-{agent}-task` must fit AWS's 64-char
 * IAM role-name limit. With the longest realistic env prefix
 * (`ender-stack-staging` = 19 chars) + `-companion-openclaw-` (20)
 * + `-task` (5) = 44 chars of overhead, the agent name can be at
 * most 20. Going higher would 403 at iam:CreateRole in staging.
 *
 * Note: the AWS target-group-name limit (TARGET_GROUP_NAME_MAX_LENGTH
 * in templates/openclaw.ts) is a separate cap with its own pre-check.
 * Both caps are exercised by validateOpenClawInput.
 *
 * Digit-start is permitted: AWS doesn't require letter-start for ECS
 * service names, ECS task-def families, IAM role names, or ELBv2
 * target group names. Names like `2026-04-30-bot` (date prefix) are
 * valid and useful for operators tracking creation dates.
 *
 * This regex is the load-bearing security control on
 * `ecs:RegisterTaskDefinition` (granted Resource:"*" with no
 * resource-level auth). A compromised admin token cannot register a
 * task-def with an arbitrary family name like `litellm` because the
 * regex constrains the `agentName` slot in the templated family.
 */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

/**
 * Backward-compatible regex used by the DELETE handler. Matches the
 * legacy 3-32 char range so agents created before AGENT_NAME_RE was
 * tightened to 3-20 (#134 per-agent IAM role-name budget) can still
 * be torn down through the API. The security argument for the
 * stricter regex is on CREATE only — `ecs:RegisterTaskDefinition`
 * is granted Resource:"*" with no resource-level auth, so the regex
 * is the security boundary on family-name shape. DELETE has no
 * equivalent escalation surface; the ECS/ELB/CW/IAM verbs on the MC
 * task role are all scoped by `companion-openclaw-*` ARN patterns
 * that the legacy 32-char names already fit under.
 *
 * After all legacy agents are torn down (or migrated by manual
 * `aws ecs delete-service` + this regex's natural decay), DELETE can
 * collapse back to AGENT_NAME_RE in a follow-up PR.
 */
export const AGENT_NAME_DELETE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

/**
 * Caps mirror the rationale that drove dropping slackWebhookUrl —
 * task-def revisions are immutable and retained indefinitely, so an
 * unbounded admin input becomes permanent storage anyone with
 * `ecs:DescribeTaskDefinition` can read.
 *
 * `roleDescription` is 200 bytes: the value flows into IDENTITY.md as
 * a single-line `Role:` bullet via init-config (ender-stack#361), where
 * a longer string would visually break the markdown structure.
 * init-config defensively truncates at 200B; matching the form cap
 * closes the trust gap (operators see the post-truncation value at
 * form-submit time, not after deploy).
 *
 * Caps for the persona fields (displayName / persona) follow the same
 * posture: short single-line fields cap at 200B or less; persona
 * (multi-paragraph prose for SOUL.md) caps at 1024B. init-config in
 * ender-stack mirrors these with defensive truncation in case the form
 * is bypassed.
 */
export const ROLE_DESCRIPTION_MAX_BYTES = 200
export const IMAGE_MAX_BYTES = 512
export const DISPLAY_NAME_MAX_BYTES = 64
export const PERSONA_MAX_BYTES = 1024

/**
 * Role-archetype slug constraints (#376).
 *
 * `AGENT_ARCHETYPE` is a directory slug under
 * `services/companion/openclaw/workspace-defaults/archetypes/<slug>/`
 * in ender-stack. init-config.sh enforces the same shape with a POSIX
 * shell glob (`*[!abcdef…0123456789-]*` — explicit enumeration to be
 * locale-immune; `[a-z0-9-]` collation-matches uppercase under
 * en_US.UTF-8). The 32-byte cap matches the directory-name limit and
 * keeps the slug short enough to fit comfortably in CloudWatch log
 * lines.
 *
 * Validates both the form-side select (allowlisted against the
 * archetypes.ts static array) AND the server-side type guard.
 */
export const ARCHETYPE_SLUG_MAX_BYTES = 32
export const ARCHETYPE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * Owner-layer fields written into the agent's USER.md on first boot
 * (#376 PR B). init-config.sh normalizes + length-caps each field
 * (CR/LF/U+2028/U+2029 → space; trim; UTF-8 byte cap) before
 * substitution, but the MC form is the primary boundary — the caps
 * below define what an operator can submit at all.
 *
 *   AGENT_OWNER_NAME (200B) — Owner display name. Lands in USER.md
 *                              `**Name:**` bullet. Cap matches the
 *                              IDENTITY.md `Role:` bullet (single-line
 *                              markdown), so the same prompt-injection
 *                              defenses apply.
 *   AGENT_OWNER_SLACK_ID    — Slack workspace user-ID. init-config
 *                              renders as `<@U...>` so the agent sees a
 *                              clickable mention. Format: U-prefix +
 *                              8-12 uppercase alphanumeric (canonical
 *                              Slack user-ID shape). ender-stack#494:
 *                              bounded at 12 to match the channel-config
 *                              consumer (lib/slack-channel-injection
 *                              SLACK_USER_ID_RE) and init-config.sh's
 *                              owner-injection filter — an owner that
 *                              create accepts must also be one init-config
 *                              will inject, else a `primary` channel
 *                              silently degrades to mention-gated.
 *   AGENT_OWNER_TZ   (64B)  — IANA timezone name (e.g.,
 *                              "America/New_York"). Longest IANA name
 *                              is ~32 chars; 64B leaves headroom for
 *                              the rare extra-long region.
 */
export const OWNER_NAME_MAX_BYTES = 200
export const OWNER_TZ_MAX_BYTES = 64
export const OWNER_SLACK_ID_RE = /^U[A-Z0-9]{8,12}$/

/**
 * Persona-field validation regexes.
 *
 * Markdown-structural-injection defense: reject ASCII control chars
 * (NUL through 0x1F + DEL) and the markdown list-item prefix forms
 * that would land in IDENTITY.md as net-new trusted bullets:
 * `^- `, `^* `, `^+ `, and `^<digits>. ` (numbered lists). The agent
 * reads IDENTITY.md as trusted persona config, so any character that
 * visually breaks the markdown structure is an injection vector once
 * operator-supplied form input is wired to AGENT_DISPLAY_NAME /
 * AGENT_ROLE.
 *
 * displayName / roleDescription apply this restriction. persona
 * (free-form prose for SOUL.md) does NOT — operators legitimately
 * want to write markdown in SOUL.md.
 *
 * Implementation: the regex rejects strings that EITHER contain a
 * control char OR start with a list-item prefix. Tests assert both
 * negatives are caught.
 */
export const PERSONA_FIELD_DISALLOWED_PREFIX_RE = /^(?:[-*+][ \t]|\d+\.[ \t])/
// eslint-disable-next-line no-control-regex
export const PERSONA_FIELD_CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/

/**
 * Wire-protocol error code for the harness-defaults endpoint when
 * the deployment prefix is so long that no legal agent name fits.
 * Exported as a shared constant so the server (`api/harness-defaults.ts`)
 * and client (`panels/create-agent-form.tsx`) reference the same
 * literal — a server-side rename without updating the client would
 * silently un-block the form-submit gate that this code triggers.
 *
 * Tests intentionally assert the literal string to protect against
 * accidental rename of the wire shape — they do NOT import this
 * constant. Round-11 audit on PR #39.
 */
export const PREFIX_TOO_LONG_ERROR = 'PrefixTooLongForHarness'
