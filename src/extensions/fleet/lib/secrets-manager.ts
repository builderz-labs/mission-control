/**
 * Secrets Manager wrapper — Phase 2.4 Beat 5b.2.
 *
 * Encapsulates the per-agent Slack secret lifecycle for the
 * credential-paste handler:
 *   - Construct fully-qualified secret name + ARN from the env-var
 *     prefix (`MC_AGENT_SECRETS_NAME_PREFIX`) + agent name + secret
 *     type (`slack-app-token` / `slack-bot-token` / `slack-signing-secret`).
 *   - Put-or-Create idempotency: attempts `PutSecretValue` first;
 *     on `ResourceNotFoundException` falls through to `CreateSecret`
 *     with tags. This is the auditor-recommended pattern over
 *     describe-first (avoids the TOCTOU window flagged on Beat 5a
 *     round-3 audit, ender-stack#268).
 *
 * The IAM contract this assumes (provisioned by Beat 5a, ender-stack
 * #268): MC's task role has Create/Put/Tag/Describe on
 * `${project}/${env}/companion-openclaw-*-slack-*`. Outside that
 * scope every call 403s.
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  RestoreSecretCommand,
} from '@aws-sdk/client-secrets-manager'

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const secretsClient = new SecretsManagerClient({ region: AWS_REGION_AT_LOAD })

/** The three Slack secret types Phase-2.4 stores per agent. */
export type SlackSecretType =
  | 'slack-app-token'
  | 'slack-bot-token'
  | 'slack-signing-secret'

export const SLACK_SECRET_TYPES: readonly SlackSecretType[] = [
  'slack-app-token',
  'slack-bot-token',
  'slack-signing-secret',
] as const

export interface SlackSecretArns {
  appToken: string
  botToken: string
  signingSecret: string
}

/**
 * Build the full secret name from prefix + agent name + type.
 * Mirrors the IAM scope pattern in
 * `ender-stack/terraform/modules/iam/main.tf::SecretsManagerWriteAgentSlack`
 * (`${project}/${env}/companion-openclaw-*-slack-*`).
 */
export function secretName(
  prefix: string,
  agentName: string,
  type: SlackSecretType,
): string {
  return `${prefix}-${agentName}-${type}`
}

/**
 * Resolve the env-injected `MC_AGENT_SECRETS_NAME_PREFIX`. Throws
 * with a clear ConfigurationError message if unset, matching the
 * `getMissingEnv` pattern in the create-agent handler. Phase-2.4
 * Beat 5a wires this env var; deployments without that wiring
 * (partial environments) should fail fast with an actionable
 * message rather than 403 deep inside a SecretsManager call.
 */
export function requireSecretsPrefix(): string {
  const prefix = process.env.MC_AGENT_SECRETS_NAME_PREFIX
  if (!prefix) {
    // Round-4 audit (Claude C3): error message generalized — the
    // function is now called from both Slack credentials and the
    // LiteLLM virtual-key flow. Earlier Slack-specific message was
    // actively misleading in the LiteLLM context.
    const err = new Error(
      'MC_AGENT_SECRETS_NAME_PREFIX is not set. Per-agent secrets (Slack credentials, LiteLLM virtual keys) cannot be located without it.',
    )
    err.name = 'ConfigurationError'
    throw err
  }
  return prefix
}

/**
 * Build the platform-required tag set for a per-agent Slack secret.
 * Matches the tag conventions from the surrounding agent resources
 * (ECS service / target group / log group). Tags are set at
 * CreateSecret time only; subsequent PutSecretValue calls don't
 * touch them (the IAM grant doesn't include UntagResource —
 * removed per Beat 5a round-2 audit).
 */
function defaultTags(
  projectName: string,
  environment: string,
  agentName: string,
  secretType: SlackSecretType,
): Array<{ Key: string; Value: string }> {
  return [
    { Key: 'Project', Value: projectName },
    { Key: 'Environment', Value: environment },
    { Key: 'Owner', Value: 'mission-control' },
    { Key: 'ManagedBy', Value: 'mission-control' },
    { Key: 'Component', Value: 'agent-credential' },
    { Key: 'AgentName', Value: agentName },
    { Key: 'SecretType', Value: secretType },
  ]
}

interface PutOrCreateInput {
  name: string
  value: string
  description: string
  /** Tags applied only on CreateSecret; ignored on the PutSecretValue path. */
  tags: Array<{ Key: string; Value: string }>
}

interface PutOrCreateResult {
  /** ARN of the secret after the operation. */
  arn: string
  /** Which path the call took — useful for logging + tests. */
  operation: 'created' | 'updated'
}

/**
 * Detect AWS SM's "secret is scheduled for deletion" / "pending
 * deletion" InvalidRequestException — the recovery path is
 * RestoreSecret, not retry. AWS does not give us a structured
 * error code for this case, only a message; matching loosely on
 * the two phrasings AWS has shipped historically (recovery-window
 * + immediate-deletion).
 */
function isPendingDeletionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: string; message?: string }
  if (e.name !== 'InvalidRequestException') return false
  if (typeof e.message !== 'string') return false
  return /scheduled for deletion|pending deletion|marked for deletion/i.test(
    e.message,
  )
}

/**
 * Internal entry point — accepts a recursion depth counter so the
 * PendingDeletion-restore-and-retry branches can't loop unbounded
 * if SM returns PendingDeletion AFTER a successful RestoreSecret
 * (an SM-side race that shouldn't happen but is cheap to defend
 * against — round-3 audit on PR #68 Medium).
 */
const PUT_OR_CREATE_MAX_DEPTH = 1

async function putOrCreateSecretInner(
  input: PutOrCreateInput,
  depth: number,
): Promise<PutOrCreateResult> {
  if (depth > PUT_OR_CREATE_MAX_DEPTH) {
    const err = new Error(
      `putOrCreateSecret: PendingDeletion recursion exceeded depth ${PUT_OR_CREATE_MAX_DEPTH} for "${input.name}". RestoreSecret may have failed silently or SM is in an inconsistent state — give up and surface the failure rather than recurse.`,
    )
    err.name = 'PutOrCreatePendingDeletionRetryExhausted'
    throw err
  }
  return putOrCreateSecretBody(input, depth)
}

/**
 * Put-or-Create idempotent write. Attempts `PutSecretValue` first
 * (cheaper path for the common case where the operator is rotating
 * existing tokens). On `ResourceNotFoundException`, falls through
 * to `CreateSecret` with tags. On `InvalidRequestException` with a
 * "scheduled for deletion" / "pending deletion" message, calls
 * `RestoreSecret` and recurses (bounded by `PUT_OR_CREATE_MAX_DEPTH`).
 *
 * Why not describe-first: that would have a TOCTOU window where
 * two concurrent paste requests both see "not exists" and both
 * call CreateSecret, with one throwing ResourceExistsException.
 * Put-then-create flips the race so the safer call (Put) is the
 * default, and only an explicit not-found triggers the create
 * branch. Round-3 audit on ender-stack#268 explicitly flagged this
 * pattern preference.
 */
export async function putOrCreateSecret(
  input: PutOrCreateInput,
): Promise<PutOrCreateResult> {
  return putOrCreateSecretInner(input, 0)
}

async function putOrCreateSecretBody(
  input: PutOrCreateInput,
  depth: number,
): Promise<PutOrCreateResult> {
  // #354: SM keeps deleted secret names reserved for the 7-day
  // recovery window. A recreate-within-window of the same agent
  // would otherwise 400 here. Detect PendingDeletion on both
  // Put and Create paths, call RestoreSecret first, then retry
  // (bounded by PUT_OR_CREATE_MAX_DEPTH).
  try {
    const resp = await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: input.name,
        SecretString: input.value,
      }),
    )
    // PutSecretValue succeeded — the secret already existed and we
    // updated its value. ARN should always be set per the SDK
    // contract.
    //
    // Round-3 audit on PR #48 (P1): if ARN was missing, the prior
    // shape returned `{ arn: '', operation: 'updated' }` — which
    // silently propagated through writeSlackSecrets into the
    // task-def's `secrets[].valueFrom`, causing an opaque ECS
    // crash-loop at task-launch (the awslogs/exec path can't
    // resolve `valueFrom: ''`). Throw loudly instead so the
    // operator's POST returns a clear 502 + retry-is-safe hint
    // rather than registering a broken task-def.
    //
    // Round-1 Greptile P2 already eliminated the worse failure of
    // falling through to CreateSecret on missing ARN (which would
    // throw ResourceExistsException). This change closes the
    // remaining silent-fail path.
    if (!resp.ARN) {
      const err = new Error(
        `PutSecretValue for "${input.name}" returned no ARN — refusing to register a task-def with an empty valueFrom. AWS SDK anomaly; safe to retry.`,
      )
      err.name = 'PutSecretValueMissingArn'
      throw err
    }
    return { arn: resp.ARN, operation: 'updated' }
  } catch (err) {
    if (isPendingDeletionError(err)) {
      // Secret is mid-recovery-window. Restore it (idempotent)
      // and recurse — the next Put will succeed.
      await secretsClient.send(
        new RestoreSecretCommand({ SecretId: input.name }),
      )
      return putOrCreateSecretInner(input, depth + 1)
    }
    const name = (err as { name?: string })?.name
    if (name !== 'ResourceNotFoundException') throw err
    // Fall through to create — Put said the secret doesn't
    // exist. Note: Put-then-create FLIPS the race (so the safe
    // call is default) but doesn't eliminate it on first-time
    // paste. Two concurrent first-time pastes can both see
    // ResourceNotFoundException on Put and both fall through;
    // one wins the create, the other gets ResourceExistsException
    // here. Round-6 audit on PR #48 caught the gap. We catch RES
    // and retry as Put, which always succeeds since the create
    // race winner just established the secret.
    try {
      const resp = await secretsClient.send(
        new CreateSecretCommand({
          Name: input.name,
          SecretString: input.value,
          Description: input.description,
          Tags: input.tags,
        }),
      )
      // Round-4 audit on PR #48: symmetric guard with the
      // PutSecretValue branch above. A first-time paste hits
      // CreateSecret; an SDK anomaly returning no ARN here would
      // propagate `valueFrom: ''` into the task-def — same opaque
      // ECS crash-loop the round-3 P1 fix addressed. Throw loudly
      // instead.
      if (!resp.ARN) {
        const err = new Error(
          `CreateSecret for "${input.name}" returned no ARN — refusing to register a task-def with an empty valueFrom. AWS SDK anomaly; safe to retry.`,
        )
        err.name = 'CreateSecretMissingArn'
        throw err
      }
      return { arn: resp.ARN, operation: 'created' }
    } catch (createErr) {
      if (isPendingDeletionError(createErr)) {
        // PendingDeletion can also surface here when a recreate
        // race exists. Restore and recurse — the next Put will
        // hit the live secret.
        await secretsClient.send(
          new RestoreSecretCommand({ SecretId: input.name }),
        )
        return putOrCreateSecretInner(input, depth + 1)
      }
      const createName = (createErr as { name?: string })?.name
      if (createName !== 'ResourceExistsException') throw createErr
      // Lost the create race. The secret now exists (the other
      // admin's create just established it); fall back to Put,
      // which writes our value over the race winner's. Last-
      // writer-wins is acceptable here because both pastes
      // carry the operator's intent — the alternative (failing
      // the second paste) is more confusing for the operator.
      const retryResp = await secretsClient.send(
        new PutSecretValueCommand({
          SecretId: input.name,
          SecretString: input.value,
        }),
      )
      if (!retryResp.ARN) {
        const err = new Error(
          `PutSecretValue retry after CreateSecret race for "${input.name}" returned no ARN — refusing to register a task-def with an empty valueFrom. AWS SDK anomaly; safe to retry.`,
        )
        err.name = 'PutSecretValueMissingArn'
        throw err
      }
      return { arn: retryResp.ARN, operation: 'updated' }
    }
  }
}

export interface WriteSlackSecretsInput {
  agentName: string
  projectName: string
  environment: string
  /** xapp-… app-level token for Socket Mode. */
  appToken: string
  /** xoxb-… bot user OAuth token. */
  botToken: string
  /** 32-char lowercase hex signing secret (per current Slack spec; narrowed in PR #48 round-1 from prior {32,64}). */
  signingSecret: string
}

/**
 * Write all three Slack secrets for an agent. Returns the ARNs
 * keyed by type so the caller can inject them into the task-def
 * `secrets:` field.
 *
 * Failure semantics: if any write fails, the partial ARNs map is
 * lost (we don't track what got written before the failure here).
 * The caller's outer catch should surface a 502 with what AWS
 * returned. A targeted retry (re-paste) cleans up — the
 * Put-or-Create idempotency means re-running succeeds.
 */
export async function writeSlackSecrets(
  input: WriteSlackSecretsInput,
): Promise<SlackSecretArns> {
  const prefix = requireSecretsPrefix()

  const writes = await Promise.all(
    SLACK_SECRET_TYPES.map(async (type) => {
      const name = secretName(prefix, input.agentName, type)
      const value =
        type === 'slack-app-token'
          ? input.appToken
          : type === 'slack-bot-token'
            ? input.botToken
            : input.signingSecret
      const description = `${type} for agent ${input.agentName} (Mission Control)`
      const result = await putOrCreateSecret({
        name,
        value,
        description,
        tags: defaultTags(
          input.projectName,
          input.environment,
          input.agentName,
          type,
        ),
      })
      return { type, ...result }
    }),
  )

  const byType = new Map(writes.map((w) => [w.type, w.arn]))
  // Round-4 audit on PR #48: with putOrCreateSecret now throwing
  // on missing ARN in both branches, the Map should always be
  // fully populated. The earlier `?? ''` fallbacks would have
  // silently propagated empty `valueFrom` if SLACK_SECRET_TYPES
  // and the per-write tagging ever drifted. Assert instead.
  const appTokenArn = byType.get('slack-app-token')
  const botTokenArn = byType.get('slack-bot-token')
  const signingSecretArn = byType.get('slack-signing-secret')
  if (!appTokenArn || !botTokenArn || !signingSecretArn) {
    const err = new Error(
      `writeSlackSecrets: missing ARN(s) in result map (appToken=${!!appTokenArn} botToken=${!!botTokenArn} signingSecret=${!!signingSecretArn}). This indicates a drift between SLACK_SECRET_TYPES and the per-type write loop.`,
    )
    err.name = 'WriteSlackSecretsMissingArn'
    throw err
  }
  return {
    appToken: appTokenArn,
    botToken: botTokenArn,
    signingSecret: signingSecretArn,
  }
}

/**
 * Read an agent's Slack BOT TOKEN from Secrets Manager — Phase 2.4
 * Beat 5b.3.
 *
 * The IAM contract (provisioned by Beat 5b.3a, ender-stack#276):
 * MC's task role has `secretsmanager:GetSecretValue` scoped to
 * `companion-openclaw-*-slack-bot-token*` only. App-token and
 * signing-secret are NOT readable by MC — see the SID separation
 * in `terraform/modules/iam/main.tf::SecretsManagerReadAgentBotToken`
 * for the rationale.
 *
 * Failure semantics:
 *   - `ResourceNotFoundException` → throws `SlackBotTokenNotFound`
 *     (operator hasn't run the credential-paste flow yet for this
 *     agent). Caller should surface a 404 with a "credentials not
 *     configured" hint.
 *   - `AccessDeniedException` → throws as-is (the IAM grant is
 *     missing or scoped incorrectly).
 *   - Any other AWS error → propagates to the caller's outer catch.
 *
 * Token-non-leak guarantee (round-2 audit on ender-stack#276): the
 * returned string is the raw bot token. Callers MUST NOT log it,
 * surface it in API responses, or pass it to error.message
 * payloads. The only legitimate use is as a Bearer token on the
 * outbound Slack API call.
 */
/**
 * Per-agent LiteLLM virtual-key secret name suffix (#354). Append
 * after `${prefix}-${agentName}-`. Falls under the IAM scope
 * `${project}/${env}/companion-openclaw-*-litellm-*`.
 */
export const LITELLM_KEY_SECRET_SUFFIX = 'litellm-key'

/**
 * Read the LiteLLM master key from Secrets Manager — #354. Used by
 * MC's create-agent and delete-agent handlers to authenticate to
 * the LiteLLM /key/generate and /key/delete management endpoints.
 *
 * IAM scope: MC's task role has `secretsmanager:GetSecretValue` on
 * `${project}/${env}/litellm-master-key*` (provisioned alongside
 * this PR's IAM changes — see SecretsManagerReadLiteLLMMasterKey
 * in `task_ecs_write`).
 *
 * Token-non-leak guarantee: the returned string is the raw master
 * key. Callers MUST NOT log it, surface it in API responses, or
 * pass it to error.message payloads. The only legitimate use is
 * as a Bearer token on the outbound LiteLLM API call.
 */
export async function getLiteLLMMasterKey(arn: string): Promise<string> {
  let resp
  try {
    resp = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: arn }),
    )
  } catch (err) {
    const errName = (err as { name?: string })?.name
    if (errName === 'ResourceNotFoundException') {
      const e = new Error(
        `LiteLLM master-key secret not found at ${arn}. Verify MC_LITELLM_MASTER_KEY_SECRET_ARN points at the provisioned secret.`,
      )
      e.name = 'LiteLLMMasterKeyNotFound'
      throw e
    }
    throw err
  }
  if (!resp.SecretString) {
    const err = new Error(
      `GetSecretValue for LiteLLM master-key secret returned no SecretString.`,
    )
    err.name = 'LiteLLMMasterKeyMalformed'
    throw err
  }
  return resp.SecretString
}

export interface WriteAgentLiteLLMKeyInput {
  agentName: string
  projectName: string
  environment: string
  /** The virtual key returned by LiteLLM /key/generate. */
  virtualKey: string
}

/**
 * Write (or update) a per-agent LiteLLM virtual-key secret — #354.
 * Same put-or-create idempotent shape as the Slack-secret writer.
 *
 * Naming convention: `{MC_AGENT_SECRETS_NAME_PREFIX}-{agentName}-
 * {suffix}` with `-` separators, matching the Slack-secret
 * writer's use of the shared `secretName()` helper. The IAM grant
 * (`companion-openclaw-*-litellm-*` in ender-stack PR #355) is
 * derived from this same shape. A future third per-agent secret
 * type should follow the same convention so the IAM patterns
 * align without per-type bespoke shapes.
 */
export async function writeAgentLiteLLMKey(
  input: WriteAgentLiteLLMKeyInput,
): Promise<string> {
  const prefix = requireSecretsPrefix()
  const name = `${prefix}-${input.agentName}-${LITELLM_KEY_SECRET_SUFFIX}`
  const tags: Array<{ Key: string; Value: string }> = [
    { Key: 'Project', Value: input.projectName },
    { Key: 'Environment', Value: input.environment },
    { Key: 'Owner', Value: 'mission-control' },
    { Key: 'ManagedBy', Value: 'mission-control' },
    { Key: 'Component', Value: 'agent-credential' },
    { Key: 'AgentName', Value: input.agentName },
    { Key: 'SecretType', Value: LITELLM_KEY_SECRET_SUFFIX },
  ]
  const { arn } = await putOrCreateSecret({
    name,
    value: input.virtualKey,
    description: `LiteLLM virtual key for agent ${input.agentName} (Mission Control)`,
    tags,
  })
  return arn
}

/**
 * Schedule deletion of an agent's LiteLLM virtual-key secret — #354.
 *
 * Uses a 7-day recovery window so an accidental delete can be
 * restored before the secret is permanently destroyed. A 404 is
 * treated as already-deleted (idempotent), matching the rule/TG
 * not-found posture of agents-delete.ts.
 */
export interface DeleteAgentLiteLLMKeyResult {
  /** True when SM reported "secret not found" or "already scheduled for deletion". */
  alreadyDeleted: boolean
  /** Fully-qualified secret name (caller doesn't have to reconstruct from env). */
  secretName: string
}

export async function deleteAgentLiteLLMKey(
  agentName: string,
): Promise<DeleteAgentLiteLLMKeyResult> {
  const prefix = requireSecretsPrefix()
  // Local renamed `keySecretName` (was `secretName`) to avoid
  // shadowing the exported `secretName()` helper at module top —
  // round-5 audit nit. Not a behavior change.
  const keySecretName = `${prefix}-${agentName}-${LITELLM_KEY_SECRET_SUFFIX}`
  try {
    await secretsClient.send(
      new DeleteSecretCommand({
        SecretId: keySecretName,
        RecoveryWindowInDays: 7,
      }),
    )
    return { alreadyDeleted: false, secretName: keySecretName }
  } catch (err) {
    const errName = (err as { name?: string })?.name
    if (errName === 'ResourceNotFoundException') {
      return { alreadyDeleted: true, secretName: keySecretName }
    }
    // #354 round-2 audit (Greptile P2): a second DeleteSecret on a
    // secret that is already pending deletion returns
    // InvalidRequestException with a "scheduled for deletion"
    // message, not ResourceNotFoundException. Treat that as
    // idempotently-already-deleted so a retried teardown doesn't
    // surface a spurious litellm-secret-delete-failed warning.
    if (isPendingDeletionError(err)) {
      return { alreadyDeleted: true, secretName: keySecretName }
    }
    throw err
  }
}

export async function getSlackBotToken(agentName: string): Promise<string> {
  const prefix = requireSecretsPrefix()
  const fullSecretName = secretName(prefix, agentName, 'slack-bot-token')
  // Round-9 audit on PR #49: split the GetSecretValue call into
  // a try/catch only around the AWS SDK call — the SecretString
  // emptiness check runs AFTER the catch, so SlackBotTokenMalformed
  // is thrown directly to the caller without going through this
  // function's own catch (a "throw-to-your-own-catch" pattern that
  // the auditor flagged as non-obvious).
  let resp
  try {
    resp = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: fullSecretName }),
    )
  } catch (err) {
    // Round-1 audit on PR #49: previously this catch shadowed
    // `name` (the secret ARN, defined above) with the error
    // class name, which let `if (name === 'ResourceNotFoundException')`
    // misread as comparing a secret path. Renamed to `errName`.
    const errName = (err as { name?: string })?.name
    if (errName === 'ResourceNotFoundException') {
      const e = new Error(
        `No Slack bot token stored for agent "${agentName}". Operator must run the credential-paste flow first.`,
      )
      e.name = 'SlackBotTokenNotFound'
      throw e
    }
    throw err
  }
  if (!resp.SecretString) {
    const err = new Error(
      `GetSecretValue for "${fullSecretName}" returned no SecretString — secret may have been written with binary value or is empty.`,
    )
    err.name = 'SlackBotTokenMalformed'
    throw err
  }
  return resp.SecretString
}
