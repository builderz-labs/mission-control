/**
 * Action-level outcome attribution — the prerequisite for graduated agent
 * autonomy. The fleet already measures *incident* outcomes (incident-learning.ts)
 * and *coordination-rule* outcomes (atlas-reflection.ts), but never the outcome
 * of an INDIVIDUAL agent action. Without that, the fleet can't know which of its
 * actions are safe to repeat unsupervised — so every autonomy decision is blind.
 *
 * This closes that loop, mirroring the incident learning shape:
 *
 *   CAPTURE   recordAction: log an action with its hypothesis — the metric we
 *             expect to move, the direction, the baseline value at action time,
 *             and the horizon (how long until the effect is real). Idempotent on
 *             action_key.
 *
 *   OUTCOME   measureDueActions: once an action is past its horizon, resolve the
 *             realised metric value (an externally-reported value, or a registered
 *             resolver), compute the signed improvement toward the goal, classify a
 *             verdict, and write an action_outcomes row. Unresolvable actions go
 *             'inconclusive' after a grace period rather than hanging forever.
 *
 *   ROLL UP   rebuildActionStats: aggregate outcomes into a track record per
 *             (agent, action_type), per agent, and per action_type — the trust
 *             ledger that the approvals UI and future graduated-autonomy gating
 *             read from.
 *
 * Metric resolution is pluggable: MC is the system of record, but the realised
 * numbers often live in other agents' data. Agents/webhooks can push a value via
 * reportActionOutcome; metrics MC *can* compute itself register a resolver.
 *
 * Everything above the "DB layer" banner is DB-free and unit-tested.
 */
import type Database from 'better-sqlite3'

// ---- Config (env-overridable, matches the incident loop's gating philosophy) ----

/** Days past the horizon to wait for a value before giving up and marking inconclusive. */
export const MEASURE_GRACE_DAYS = Number(process.env.ACTION_OUTCOME_GRACE_DAYS ?? 3)
/** Min decisive outcomes before a track record is considered worth trusting. */
export const STAT_MIN_HITS = Number(process.env.ACTION_STAT_MIN_HITS ?? 3)

const DAY_SECONDS = 86400

// ============================================================================
//  Pure helpers (no DB — unit-tested in __tests__/action-outcomes.test.ts)
// ============================================================================

export type MetricDirection = 'higher_is_better' | 'lower_is_better'
export type Verdict = 'success' | 'no_change' | 'regression' | 'inconclusive'

/**
 * Known action metrics → measurement direction. `boolean` metrics are 0/1
 * outcomes (did the booking extend? did the landlord renew?) and want a 0.5
 * min_delta so a 0→1 flip counts and nothing else does.
 */
export const KNOWN_ACTION_METRICS: Record<string, { direction: MetricDirection; boolean?: boolean }> = {
  booking_extended: { direction: 'higher_is_better', boolean: true },
  direct_booking: { direction: 'higher_is_better', boolean: true },
  landlord_renewed: { direction: 'higher_is_better', boolean: true },
  review_left: { direction: 'higher_is_better', boolean: true },
  upsell_taken: { direction: 'higher_is_better', boolean: true },
  occupancy_14d: { direction: 'higher_is_better' },
  occupancy_30d: { direction: 'higher_is_better' },
  adr: { direction: 'higher_is_better' },
  revpar: { direction: 'higher_is_better' },
  nights_booked: { direction: 'higher_is_better' },
  response_time_hours: { direction: 'lower_is_better' },
  resolution_hours: { direction: 'lower_is_better' },
  arrears_gbp: { direction: 'lower_is_better' },
  cancellations: { direction: 'lower_is_better' },
}

/** Normalise an action-type token: lowercased, non-alphanumerics → underscore. */
export function normaliseActionType(value?: string | null): string {
  return (value || 'unspecified').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unspecified'
}

/** Direction for a metric: explicit override, else known default, else higher-is-better. */
export function directionFor(metric?: string | null, explicit?: string | null): MetricDirection {
  if (explicit === 'higher_is_better' || explicit === 'lower_is_better') return explicit
  const known = metric ? KNOWN_ACTION_METRICS[metric.trim().toLowerCase()] : undefined
  return known?.direction ?? 'higher_is_better'
}

/** Default min_delta for a metric (booleans need 0.5; everything else 0 unless overridden). */
export function defaultMinDelta(metric?: string | null): number {
  const known = metric ? KNOWN_ACTION_METRICS[metric.trim().toLowerCase()] : undefined
  return known?.boolean ? 0.5 : 0
}

/**
 * Signed improvement toward the goal. Positive always means "better", regardless
 * of metric direction. Null if either value is missing.
 */
export function computeImprovement(
  baseline: number | null | undefined,
  result: number | null | undefined,
  direction: MetricDirection,
): number | null {
  if (baseline == null || result == null || Number.isNaN(baseline) || Number.isNaN(result)) return null
  const raw = result - baseline
  const signed = direction === 'higher_is_better' ? raw : -raw
  return Number(signed.toFixed(4))
}

/**
 * Classify an outcome. Inconclusive when we have no result to compare. A move
 * must clear minDelta (in goal-positive terms) to count as success/regression;
 * smaller moves are no_change.
 */
export function classifyVerdict(args: {
  baseline: number | null | undefined
  result: number | null | undefined
  direction: MetricDirection
  minDelta?: number
}): Verdict {
  const { baseline, result, direction } = args
  const improvement = computeImprovement(baseline, result, direction)
  if (improvement == null) return 'inconclusive'
  const threshold = Math.abs(args.minDelta ?? 0)
  if (improvement > threshold) return 'success'
  if (improvement < -threshold) return 'regression'
  return 'no_change'
}

/**
 * Confidence in a track record: grows with the number of decisive outcomes and
 * with how lopsided the success/regression split is (a 50/50 record is barely
 * informative even with many samples). 0..0.99. Mirrors incident confidenceFor.
 */
export function confidenceFor(decisive: number, successRate: number): number {
  if (decisive <= 0) return 0
  const sample = decisive / (decisive + 1)
  const consistency = Math.max(successRate, 1 - successRate) // distance from a coin-flip
  return Math.min(0.99, Number((sample * (0.5 + 0.5 * consistency)).toFixed(4)))
}

export interface OutcomeStatRow {
  agent: string
  action_type: string
  verdict: Verdict
  improvement: number | null
  reversible: boolean
}

export interface ActionStat {
  scope_type: 'agent_action' | 'agent' | 'action_type'
  scope_key: string
  agent: string | null
  action_type: string | null
  attempts: number
  successes: number
  no_change: number
  regressions: number
  inconclusive: number
  success_rate: number
  avg_improvement: number | null
  reversible_rate: number
  confidence: number
}

/**
 * Aggregate realised outcomes into a track record at three scopes:
 * per (agent, action_type), per agent, and per action_type. Pure — the DB layer
 * persists what this returns.
 */
export function buildActionStats(rows: OutcomeStatRow[]): ActionStat[] {
  const groups = new Map<
    string,
    { scope_type: ActionStat['scope_type']; agent: string | null; action_type: string | null; rows: OutcomeStatRow[] }
  >()

  const push = (key: string, scope_type: ActionStat['scope_type'], agent: string | null, action_type: string | null, r: OutcomeStatRow) => {
    const g = groups.get(key) || { scope_type, agent, action_type, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }

  for (const r of rows) {
    const agent = r.agent
    const at = r.action_type
    push(`${agent}::${at}`, 'agent_action', agent, at, r)
    push(`agent:${agent}`, 'agent', agent, null, r)
    push(`type:${at}`, 'action_type', null, at, r)
  }

  const stats: ActionStat[] = []
  for (const [key, g] of groups) {
    const rs = g.rows
    let successes = 0
    let noChange = 0
    let regressions = 0
    let inconclusive = 0
    let reversibleCount = 0
    let impSum = 0
    let impCount = 0

    for (const r of rs) {
      if (r.verdict === 'success') successes++
      else if (r.verdict === 'no_change') noChange++
      else if (r.verdict === 'regression') regressions++
      else inconclusive++
      if (r.reversible) reversibleCount++
      if (r.improvement != null) {
        impSum += r.improvement
        impCount++
      }
    }

    const decisive = successes + noChange + regressions
    const successRate = decisive > 0 ? Number((successes / decisive).toFixed(4)) : 0

    stats.push({
      scope_type: g.scope_type,
      scope_key: key,
      agent: g.agent,
      action_type: g.action_type,
      attempts: rs.length,
      successes,
      no_change: noChange,
      regressions,
      inconclusive,
      success_rate: successRate,
      avg_improvement: impCount > 0 ? Number((impSum / impCount).toFixed(4)) : null,
      reversible_rate: Number((reversibleCount / rs.length).toFixed(4)),
      confidence: confidenceFor(decisive, successRate),
    })
  }

  // Most-specific scope first, then most confident.
  stats.sort((a, b) => {
    const rank = { agent_action: 0, agent: 1, action_type: 2 }
    if (a.scope_type !== b.scope_type) return rank[a.scope_type] - rank[b.scope_type]
    return b.confidence - a.confidence
  })
  return stats
}

// ============================================================================
//  Metric resolver registry
// ============================================================================

export interface AgentActionRow {
  id: number
  action_key: string
  agent: string
  action_type: string
  target_type: string | null
  target_id: string | null
  metric: string
  metric_direction: MetricDirection
  baseline: number | null
  min_delta: number
  horizon_days: number
  reversible: number
  source: string
  status: string
  reported_result: number | null
  taken_at: number
  measure_after: number
  workspace_id: number
}

export type MetricResolver = (db: Database.Database, action: AgentActionRow) => number | null

const resolvers = new Map<string, MetricResolver>()

/** Register a function that computes the realised value of a metric for an action. */
export function registerMetricResolver(metric: string, fn: MetricResolver): void {
  resolvers.set(metric.trim().toLowerCase(), fn)
}

export function getMetricResolver(metric: string | null | undefined): MetricResolver | null {
  if (!metric) return null
  return resolvers.get(metric.trim().toLowerCase()) ?? null
}

// ============================================================================
//  DB layer
// ============================================================================

export interface RecordActionInput {
  action_key?: string | null
  agent: string
  action_type: string
  metric: string
  target_type?: string | null
  target_id?: string | null
  title?: string | null
  description?: string | null
  metric_direction?: MetricDirection | null
  baseline?: number | null
  min_delta?: number | null
  horizon_days?: number | null
  reversible?: boolean | null
  blast_radius?: unknown
  source?: string | null
  source_task_id?: number | null
  requested_by?: string | null
}

export interface RecordedAction {
  id: number
  action_key: string
  measure_after: number
  created: boolean
}

/** CAPTURE — log an agent action + its hypothesis. Idempotent on (action_key, workspace). */
export function recordAction(db: Database.Database, input: RecordActionInput, workspaceId = 1, now = Math.floor(Date.now() / 1000)): RecordedAction {
  const agent = (input.agent || '').trim()
  const actionType = normaliseActionType(input.action_type)
  const metric = (input.metric || '').trim()
  if (!agent) throw new Error('recordAction: agent is required')
  if (!metric) throw new Error('recordAction: metric is required')

  const direction = directionFor(metric, input.metric_direction)
  const minDelta = input.min_delta != null ? Math.abs(input.min_delta) : defaultMinDelta(metric)
  const horizon = input.horizon_days != null && input.horizon_days > 0 ? Math.floor(input.horizon_days) : 14
  const takenAt = now
  const measureAfter = takenAt + horizon * DAY_SECONDS
  const reversible = input.reversible === false ? 0 : 1
  const blast = input.blast_radius != null ? JSON.stringify(input.blast_radius) : null
  const actionKey =
    (input.action_key && input.action_key.trim()) ||
    `${agent}:${actionType}:${input.target_id || 'na'}:${takenAt}`

  const existing = db
    .prepare(`SELECT id, measure_after FROM agent_actions WHERE action_key = ? AND workspace_id = ?`)
    .get(actionKey, workspaceId) as { id: number; measure_after: number } | undefined
  if (existing) {
    return { id: existing.id, action_key: actionKey, measure_after: existing.measure_after, created: false }
  }

  const info = db
    .prepare(
      `INSERT INTO agent_actions (
         action_key, agent, action_type, target_type, target_id, title, description,
         metric, metric_direction, baseline, min_delta, horizon_days,
         reversible, blast_radius, source, source_task_id, requested_by,
         status, taken_at, measure_after, created_at, updated_at, workspace_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .run(
      actionKey, agent, actionType, input.target_type ?? null, input.target_id ?? null, input.title ?? null, input.description ?? null,
      metric, direction, input.baseline ?? null, minDelta, horizon,
      reversible, blast, (input.source || 'agent').trim(), input.source_task_id ?? null, input.requested_by ?? null,
      takenAt, measureAfter, takenAt, takenAt, workspaceId,
    )

  return { id: Number(info.lastInsertRowid), action_key: actionKey, measure_after: measureAfter, created: true }
}

function getAction(db: Database.Database, id: number): AgentActionRow | undefined {
  return db.prepare(`SELECT * FROM agent_actions WHERE id = ?`).get(id) as AgentActionRow | undefined
}

/** Internal: write the outcome row + flip the action to measured. */
function finaliseOutcome(
  db: Database.Database,
  action: AgentActionRow,
  result: number | null,
  resolvedBy: string,
  now: number,
  notes?: string | null,
): Verdict {
  const direction = directionFor(action.metric, action.metric_direction)
  const verdict = classifyVerdict({ baseline: action.baseline, result, direction, minDelta: action.min_delta })
  const improvement = computeImprovement(action.baseline, result, direction)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO action_outcomes (
         action_id, agent, action_type, target_type, target_id,
         metric, metric_direction, baseline, result, improvement, verdict, resolved_by, notes, measured_at, workspace_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(action_id) DO UPDATE SET
         result = excluded.result, improvement = excluded.improvement, verdict = excluded.verdict,
         resolved_by = excluded.resolved_by, notes = excluded.notes, measured_at = excluded.measured_at`,
    ).run(
      action.id, action.agent, action.action_type, action.target_type, action.target_id,
      action.metric, direction, action.baseline, result, improvement, verdict, resolvedBy, notes ?? null, now, action.workspace_id,
    )
    db.prepare(`UPDATE agent_actions SET status = 'measured', measured_at = ?, updated_at = ? WHERE id = ?`).run(now, now, action.id)
  })()

  return verdict
}

/**
 * Fast path — an agent or webhook reports the realised value directly. Measures
 * immediately regardless of horizon. Returns the verdict, or null if no action.
 */
export function reportActionOutcome(
  db: Database.Database,
  selector: { actionId?: number; actionKey?: string; workspaceId?: number },
  result: number | null,
  notes?: string | null,
  now = Math.floor(Date.now() / 1000),
): { action_id: number; verdict: Verdict } | null {
  let action: AgentActionRow | undefined
  if (selector.actionId != null) action = getAction(db, selector.actionId)
  else if (selector.actionKey) {
    action = db
      .prepare(`SELECT * FROM agent_actions WHERE action_key = ? AND workspace_id = ?`)
      .get(selector.actionKey, selector.workspaceId ?? 1) as AgentActionRow | undefined
  }
  if (!action) return null

  // Stash the reported value too, so a re-run of measureDueActions is consistent.
  db.prepare(`UPDATE agent_actions SET reported_result = ?, updated_at = ? WHERE id = ?`).run(result, now, action.id)
  const verdict = finaliseOutcome(db, { ...action, reported_result: result }, result, 'reported', now, notes)
  return { action_id: action.id, verdict }
}

export interface MeasureStats {
  due: number
  measured: number
  inconclusive: number
  success: number
  regression: number
  pending: number
}

/**
 * OUTCOME — score every pending action that is past its horizon. Resolves the
 * realised value from a reported value or a registered resolver; if neither is
 * available it leaves the action pending until grace expires, then marks it
 * inconclusive. Never throws on an individual action.
 */
export function measureDueActions(db: Database.Database, workspaceId = 1, now = Math.floor(Date.now() / 1000)): MeasureStats {
  const stats: MeasureStats = { due: 0, measured: 0, inconclusive: 0, success: 0, regression: 0, pending: 0 }
  const due = db
    .prepare(`SELECT * FROM agent_actions WHERE workspace_id = ? AND status = 'pending' AND measure_after <= ? ORDER BY measure_after ASC`)
    .all(workspaceId, now) as AgentActionRow[]
  stats.due = due.length

  for (const action of due) {
    try {
      let result: number | null = null
      let resolvedBy = 'timeout'

      if (action.reported_result != null) {
        result = action.reported_result
        resolvedBy = 'reported'
      } else {
        const resolver = getMetricResolver(action.metric)
        if (resolver) {
          try {
            result = resolver(db, action)
          } catch {
            result = null
          }
          if (result != null) resolvedBy = `resolver:${action.metric}`
        }
      }

      // No value yet, still inside grace → leave pending, try again next pass.
      if (result == null && now < action.measure_after + MEASURE_GRACE_DAYS * DAY_SECONDS) {
        stats.pending++
        continue
      }

      const verdict = finaliseOutcome(db, action, result, resolvedBy, now)
      stats.measured++
      if (verdict === 'success') stats.success++
      else if (verdict === 'regression') stats.regression++
      else if (verdict === 'inconclusive') stats.inconclusive++
    } catch {
      stats.pending++
    }
  }

  return stats
}

/** ROLL UP — rebuild the trust ledger from all realised outcomes. */
export function rebuildActionStats(db: Database.Database, workspaceId = 1, now = Math.floor(Date.now() / 1000)): number {
  const rows = db
    .prepare(
      `SELECT o.agent, o.action_type, o.verdict, o.improvement, a.reversible
         FROM action_outcomes o JOIN agent_actions a ON a.id = o.action_id
        WHERE o.workspace_id = ?`,
    )
    .all(workspaceId) as Array<{ agent: string; action_type: string; verdict: Verdict; improvement: number | null; reversible: number }>

  const stats = buildActionStats(
    rows.map((r) => ({ agent: r.agent, action_type: r.action_type, verdict: r.verdict, improvement: r.improvement, reversible: !!r.reversible })),
  )

  db.transaction(() => {
    db.prepare(`DELETE FROM agent_action_stats WHERE workspace_id = ?`).run(workspaceId)
    const insert = db.prepare(
      `INSERT INTO agent_action_stats (
         scope_type, scope_key, agent, action_type, attempts, successes, no_change, regressions, inconclusive,
         success_rate, avg_improvement, reversible_rate, confidence, computed_at, workspace_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const s of stats) {
      insert.run(
        s.scope_type, s.scope_key, s.agent, s.action_type, s.attempts, s.successes, s.no_change, s.regressions, s.inconclusive,
        s.success_rate, s.avg_improvement, s.reversible_rate, s.confidence, now, workspaceId,
      )
    }
  })()

  return stats.length
}

// ---- Dashboard / ledger aggregation ----

export interface ActionLedger {
  ledger: any[]      // per (agent, action_type) track records, most trusted first
  by_agent: any[]
  by_type: any[]
  recent: any[]      // recent measured outcomes
  summary: {
    actions_total: number
    pending: number
    measured: number
    success: number
    regression: number
    inconclusive: number
    overall_success_rate: number
    trusted_scopes: number   // (agent, action_type) records with enough decisive evidence
  }
}

export function getActionLedger(db: Database.Database, workspaceId = 1): ActionLedger {
  const stats = db
    .prepare(`SELECT * FROM agent_action_stats WHERE workspace_id = ? ORDER BY confidence DESC, attempts DESC`)
    .all(workspaceId) as any[]

  const ledger = stats.filter((s) => s.scope_type === 'agent_action')
  const byAgent = stats.filter((s) => s.scope_type === 'agent')
  const byType = stats.filter((s) => s.scope_type === 'action_type')

  const recent = db
    .prepare(
      `SELECT o.*, a.title, a.target_id, a.taken_at
         FROM action_outcomes o JOIN agent_actions a ON a.id = o.action_id
        WHERE o.workspace_id = ? ORDER BY o.measured_at DESC LIMIT 50`,
    )
    .all(workspaceId) as any[]

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM agent_actions WHERE workspace_id = ?) AS actions_total,
         (SELECT COUNT(*) FROM agent_actions WHERE workspace_id = ? AND status = 'pending') AS pending,
         (SELECT COUNT(*) FROM action_outcomes WHERE workspace_id = ?) AS measured,
         (SELECT COUNT(*) FROM action_outcomes WHERE workspace_id = ? AND verdict = 'success') AS success,
         (SELECT COUNT(*) FROM action_outcomes WHERE workspace_id = ? AND verdict = 'regression') AS regression,
         (SELECT COUNT(*) FROM action_outcomes WHERE workspace_id = ? AND verdict = 'inconclusive') AS inconclusive`,
    )
    .get(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId) as any

  const decisive = (counts.success || 0) + (counts.regression || 0) +
    ((counts.measured || 0) - (counts.success || 0) - (counts.regression || 0) - (counts.inconclusive || 0))
  const overallSuccessRate = decisive > 0 ? Number(((counts.success || 0) / decisive).toFixed(4)) : 0
  const trustedScopes = ledger.filter((s) => (s.successes + s.no_change + s.regressions) >= STAT_MIN_HITS).length

  return {
    ledger,
    by_agent: byAgent,
    by_type: byType,
    recent,
    summary: {
      actions_total: counts.actions_total || 0,
      pending: counts.pending || 0,
      measured: counts.measured || 0,
      success: counts.success || 0,
      regression: counts.regression || 0,
      inconclusive: counts.inconclusive || 0,
      overall_success_rate: overallSuccessRate,
      trusted_scopes: trustedScopes,
    },
  }
}

/** Workspaces that have logged at least one action. */
function workspacesWithActions(db: Database.Database): number[] {
  try {
    const rows = db.prepare(`SELECT DISTINCT workspace_id FROM agent_actions`).all() as Array<{ workspace_id: number }>
    return rows.length ? rows.map((r) => r.workspace_id) : [1]
  } catch {
    return [1]
  }
}

/**
 * Scheduler entrypoint — measure every workspace's due actions and rebuild the
 * trust ledger. Never throws; returns the { ok, message } shape the tick expects.
 */
export async function runActionOutcomeMeasurement(): Promise<{ ok: boolean; message: string }> {
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    let measured = 0
    let success = 0
    let regression = 0
    let pending = 0
    let scopes = 0
    for (const ws of workspacesWithActions(db)) {
      const m = measureDueActions(db, ws)
      measured += m.measured
      success += m.success
      regression += m.regression
      pending += m.pending
      scopes += rebuildActionStats(db, ws)
    }
    return {
      ok: true,
      message: `Action outcomes: ${measured} measured (${success} success, ${regression} regression), ${pending} awaiting data; ${scopes} ledger scope(s) refreshed`,
    }
  } catch (err: any) {
    const { logger } = await import('./logger')
    logger.error({ err }, 'runActionOutcomeMeasurement failed')
    return { ok: false, message: `Action outcome measurement failed: ${err.message}` }
  }
}
