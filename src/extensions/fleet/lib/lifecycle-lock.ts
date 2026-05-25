/**
 * Per-agent lifecycle lock — ender-stack#480 Risk 1.
 *
 * Serializes create-agent and delete-agent for a given agent name so a
 * DELETE can't run its absent-service teardown concurrently with a
 * CREATE that's mid-provisioning. create-agent builds the IAM roles,
 * LiteLLM key/secret, log group, task-def, target group, and listener
 * rule BEFORE `CreateService` (the last step). In that window the ECS
 * service doesn't exist yet, so a concurrent DELETE sees an absent
 * service and — even with the #480 Risk 2 ownership guard — would tear
 * down the resources the create just made (the guard can't help here:
 * create writes the same MC ownership tags, so a half-built agent looks
 * identical to a finished one). A mutual-exclusion lock is the only fix.
 *
 * Mechanism: an SSM Parameter Store advisory lock at
 * `/${project}/${env}/companion-openclaw/${agent}/lifecycle-lock`.
 * `PutParameter` with `Overwrite: false` is an atomic compare-and-set —
 * it throws `ParameterAlreadyExists` if a lock is already held, which is
 * the acquire primitive. Release is `DeleteParameter`.
 *
 * Staleness: SSM parameters have no native TTL, so a handler that
 * crashes mid-op would leave a lock that blocks the name forever.
 * Guard against that by storing the acquire timestamp in the value and
 * treating a lock older than {@link LIFECYCLE_LOCK_TTL_MS} as stale +
 * reclaimable. A normal create/delete finishes in seconds; the 5-minute
 * window only ever fires after a crash. The reclaim has a narrow TOCTOU
 * (two handlers both seeing the same stale lock and both overwriting),
 * accepted because the endpoint is admin-gated and the window only
 * opens after an abandoned lock — never during normal operation.
 *
 * Authoritative, NOT best-effort: unlike `slack-ssm-bridge.ts` (which
 * pins `maxAttempts: 1` because a failed write only degrades
 * drift-resistance), a missed acquire/release here corrupts
 * serialization. We keep the SDK's default retry budget and FAIL CLOSED
 * on a genuine SSM error — the caller returns 503 rather than running
 * an unserialized lifecycle op.
 *
 * IAM grant: `task_ssm_lifecycle_lock` in ender-stack
 * `terraform/modules/iam/main.tf` grants `ssm:PutParameter` +
 * `ssm:GetParameter` + `ssm:DeleteParameter` scoped to the exact path
 * pattern below (`…/companion-openclaw/<agent>/lifecycle-lock`). The
 * lock value is a plain `String` (not SecureString), so no KMS grant is
 * needed. A typo in the path here means a silent 403 → 503 on every
 * create/delete, not a security hole.
 *
 * Caller contract: `agentName` MUST already be validated against
 * AGENT_NAME_RE / AGENT_NAME_DELETE_RE (lowercase alphanumeric + hyphen,
 * no slashes) before calling. Both fleet handlers validate before
 * acquiring. This is load-bearing twice over: the name is embedded in
 * the lock path here, AND the IAM resource ARN wildcards on the
 * agent-name segment — a slash would let the wildcard span path
 * segments and escape the companion-openclaw namespace.
 *
 * NOTE: this lib lives outside `src/extensions/fleet/api/`, so the
 * `check-iam-coverage.mjs` scanner does not see these SDK calls (it
 * scans only api/ route handlers — same as slack-ssm-bridge.ts). The
 * IAM grant is therefore enforced by dev validation + this JSDoc, not
 * the coverage gate.
 */

import { randomUUID } from 'node:crypto'
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
  DeleteParameterCommand,
} from '@aws-sdk/client-ssm'
import { logger } from '@/lib/logger'

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ssmClient = new SSMClient({ region: AWS_REGION_AT_LOAD })

/**
 * A lock older than this is treated as stale and reclaimable. Normal
 * create/delete completes in seconds; this covers the slowest observed
 * teardown with wide margin while letting a crashed handler's lock be
 * reclaimed promptly.
 */
export const LIFECYCLE_LOCK_TTL_MS = 5 * 60 * 1000

/** Lifecycle operation holding (or contending for) the lock. */
export type LifecycleOp = 'create' | 'delete'

/** Decoded lock value written into the SSM parameter. */
export interface LifecycleLockHolder {
  op: LifecycleOp
  /** Diagnostic only — the requesting actor id (auth.user.id is numeric). */
  actor?: string | number
  /** Epoch ms when the lock was acquired — drives staleness. */
  ts: number
  /**
   * Per-acquisition fencing token. The release path only deletes the
   * parameter when the stored token still matches the releaser's token,
   * so a handler that ran past the TTL (and was reclaimed by a newer op)
   * can't delete the successor's lock on its way out.
   */
  token?: string
}

export type AcquireLockResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'held'; heldBy: LifecycleLockHolder }
  | { ok: false; reason: 'error'; errorName: string }

/**
 * Bound on the vanished-lock retry loop. A lock that disappears between
 * our failed atomic acquire and the staleness read is re-attempted as a
 * fresh atomic acquire (never an overwrite — that would clobber a holder
 * that acquired in the gap). The loop is tiny and only spins under
 * active create-vs-delete contention churn.
 */
const MAX_ACQUIRE_ATTEMPTS = 3

export interface LifecycleLockInput {
  projectName: string
  environment: string
  agentName: string
}

export interface AcquireLockInput extends LifecycleLockInput {
  op: LifecycleOp
  actor?: string | number
}

const PARAM_ALREADY_EXISTS = 'ParameterAlreadyExists'
const PARAM_NOT_FOUND = 'ParameterNotFound'

function errName(err: unknown): string {
  return (err as { name?: string })?.name ?? 'UnknownError'
}

/**
 * Build the lock parameter name. Exported so handlers + tests share the
 * literal convention; MUST match the IAM grant's resource ARN pattern
 * in ender-stack `terraform/modules/iam/main.tf`.
 */
export function lifecycleLockParamName(
  projectName: string,
  environment: string,
  agentName: string,
): string {
  return `/${projectName}/${environment}/companion-openclaw/${agentName}/lifecycle-lock`
}

function parseHolder(raw: string | undefined): LifecycleLockHolder | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as Partial<LifecycleLockHolder>
    // Narrow op to the LifecycleOp union (not just `string`) before the
    // cast — a tampered/corrupt parameter with e.g. op:"arbitrary" would
    // otherwise surface verbatim in the client-visible 409 detail.
    if (
      typeof v.ts === 'number' &&
      (v.op === 'create' || v.op === 'delete')
    ) {
      return v as LifecycleLockHolder
    }
  } catch {
    // Unparseable value — treat as a corrupt/stale lock (caller reclaims).
  }
  return undefined
}

/**
 * Acquire the per-agent lifecycle lock.
 *
 *   - `{ ok: true }`                      — lock held by this caller; the
 *                                           caller MUST {@link releaseLifecycleLock}
 *                                           in a `finally`.
 *   - `{ ok: false, reason: 'held' }`     — another lifecycle op holds a
 *                                           fresh lock; caller returns 409.
 *   - `{ ok: false, reason: 'error' }`    — genuine SSM failure; caller
 *                                           returns 503 (fail closed).
 */
export async function acquireLifecycleLock(
  input: AcquireLockInput,
): Promise<AcquireLockResult> {
  const name = lifecycleLockParamName(
    input.projectName,
    input.environment,
    input.agentName,
  )
  const token = randomUUID()
  const value: LifecycleLockHolder = {
    op: input.op,
    actor: input.actor,
    ts: Date.now(),
    token,
  }
  const valueJson = JSON.stringify(value)

  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt++) {
    // Atomic acquire: Overwrite=false throws ParameterAlreadyExists if a
    // lock is already held.
    try {
      await ssmClient.send(
        new PutParameterCommand({
          Name: name,
          Type: 'String',
          Value: valueJson,
          Overwrite: false,
        }),
      )
      return { ok: true, token }
    } catch (err) {
      if (errName(err) !== PARAM_ALREADY_EXISTS) {
        logger.error(
          { agentName: input.agentName, op: input.op, errorName: errName(err) },
          '[fleet] lifecycle-lock: acquire failed on a non-contention SSM error — failing closed',
        )
        return { ok: false, reason: 'error', errorName: errName(err) }
      }
    }

    // A lock exists — read it to decide held-vs-stale.
    let heldBy: LifecycleLockHolder | undefined
    try {
      const got = await ssmClient.send(new GetParameterCommand({ Name: name }))
      heldBy = parseHolder(got.Parameter?.Value)
    } catch (err) {
      if (errName(err) === PARAM_NOT_FOUND) {
        // Released/vanished between our atomic acquire and this read.
        // RETRY the atomic Overwrite=false acquire rather than reclaim
        // with Overwrite=true — overwriting here would clobber a holder
        // that legitimately acquired the now-empty slot in the gap
        // (Greptile #85 P1 "vanished lock clobbers holder").
        continue
      }
      logger.error(
        { agentName: input.agentName, op: input.op, errorName: errName(err) },
        '[fleet] lifecycle-lock: GetParameter failed while resolving contention — failing closed',
      )
      return { ok: false, reason: 'error', errorName: errName(err) }
    }

    const ageMs = heldBy ? Date.now() - heldBy.ts : Infinity
    if (heldBy && ageMs < LIFECYCLE_LOCK_TTL_MS) {
      return { ok: false, reason: 'held', heldBy }
    }

    // Stale (older than TTL) or corrupt/unparseable but present — reclaim
    // with Overwrite=true, stamping OUR token so the release ownership
    // check below is meaningful. This is the one documented residual
    // TOCTOU: two callers that both observe the SAME stale lock can both
    // overwrite. Only reachable after a crash leaves a lock older than
    // the TTL, on an admin-gated endpoint — proportionate.
    try {
      await ssmClient.send(
        new PutParameterCommand({
          Name: name,
          Type: 'String',
          Value: valueJson,
          Overwrite: true,
        }),
      )
      logger.warn(
        {
          agentName: input.agentName,
          op: input.op,
          reclaimedAgeMs: Number.isFinite(ageMs) ? ageMs : undefined,
          priorHolder: heldBy,
        },
        '[fleet] lifecycle-lock: reclaimed a stale/abandoned lock',
      )
      return { ok: true, token }
    } catch (err) {
      logger.error(
        { agentName: input.agentName, op: input.op, errorName: errName(err) },
        '[fleet] lifecycle-lock: stale-lock reclaim failed — failing closed',
      )
      return { ok: false, reason: 'error', errorName: errName(err) }
    }
  }

  // Exhausted the vanished-lock retry budget — the slot kept flipping
  // between empty and held under contention. Fail closed; the caller
  // 503s and the operator retries.
  logger.error(
    { agentName: input.agentName, op: input.op },
    '[fleet] lifecycle-lock: acquire exhausted retries under contention — failing closed',
  )
  return { ok: false, reason: 'error', errorName: 'LockAcquireContention' }
}

/**
 * Release the per-agent lifecycle lock. Best-effort + idempotent.
 *
 * Ownership-checked (Greptile #85 P1 "release deletes successors"): the
 * parameter is only deleted when the stored fencing `token` still
 * matches the releaser's `token`. If this handler ran past the TTL and a
 * newer op reclaimed the lock, the stored token won't match — so we
 * leave the successor's lock in place instead of deleting it (which
 * would let a third op acquire and run concurrently with the reclaimer).
 *
 * If the ownership read fails for any reason other than a clean
 * not-found, we DON'T delete — better to let the lock self-expire after
 * {@link LIFECYCLE_LOCK_TTL_MS} than risk clobbering a successor. A
 * missing parameter (already released / never acquired) is a no-op. When
 * no `token` is supplied (legacy/best-effort callers) the check is
 * skipped and the parameter is deleted unconditionally.
 */
export async function releaseLifecycleLock(
  input: LifecycleLockInput & { token?: string },
): Promise<void> {
  const name = lifecycleLockParamName(
    input.projectName,
    input.environment,
    input.agentName,
  )

  if (input.token) {
    try {
      const got = await ssmClient.send(new GetParameterCommand({ Name: name }))
      const holder = parseHolder(got.Parameter?.Value)
      if (holder?.token && holder.token !== input.token) {
        // We no longer own the lock — a newer op reclaimed it. Deleting
        // here would strand the successor; leave it.
        logger.warn(
          { agentName: input.agentName, heldByToken: holder.token },
          '[fleet] lifecycle-lock: release skipped — lock was reclaimed by a newer op (token mismatch)',
        )
        return
      }
    } catch (err) {
      if (errName(err) === PARAM_NOT_FOUND) return // already released
      logger.error(
        { agentName: input.agentName, errorName: errName(err) },
        `[fleet] lifecycle-lock: ownership read failed during release — leaving lock to self-expire after ${LIFECYCLE_LOCK_TTL_MS}ms rather than risk clobbering a successor`,
      )
      return
    }
  }

  try {
    await ssmClient.send(new DeleteParameterCommand({ Name: name }))
  } catch (err) {
    if (errName(err) === PARAM_NOT_FOUND) return
    logger.error(
      { agentName: input.agentName, errorName: errName(err) },
      `[fleet] lifecycle-lock: release failed — lock will self-expire after ${LIFECYCLE_LOCK_TTL_MS}ms`,
    )
  }
}
