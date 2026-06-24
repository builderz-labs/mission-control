/**
 * Incident learning loop -- closes the feedback loop on property incidents.
 *
 * Modelled on Sofia's correctionLearner (shadow -> armed): we PROPOSE scoring
 * rules from realised outcomes, gate them on min-hits + consistency + confidence,
 * keep them in SHADOW by default, and only ARM (let them shape new predictions)
 * once they clear a higher bar. A human can manually arm/reject a rule and the
 * automatic pass will never override that choice (status_source = 'manual').
 *
 *   CAPTURE   onIncidentCreated: snapshot the triage prediction (predicted
 *             severity/impact) onto the incident, optionally seeded by an armed
 *             rule.
 *
 *   OUTCOME   onIncidentResolved: derive the ACTUAL severity/impact from realised
 *             multi-source signals (James cost, Iris guest impact, resolution
 *             time), compute the delta vs the prediction, detect recurrence, and
 *             write an incident_outcomes row.
 *
 *   PROMOTE   learnRules: aggregate outcomes by (property,category) and (category),
 *             build learned_scoring_rules, gate + auto-arm, refresh prediction
 *             accuracy snapshots.
 *
 *   CONSUME   predictForIncident: given a property + category, return the best
 *             matching rule's prediction (armed rules apply, shadow rules only
 *             annotate).
 *
 * Everything below the "Pure helpers" banner is DB-free and unit-tested.
 */
import type Database from 'better-sqlite3'

// ---- Config (env-overridable, matches Sofia's gating philosophy) ----

export const LEARN_MIN_HITS = Number(process.env.INCIDENT_LEARN_MIN_HITS ?? 3)
export const ARM_MIN_HITS = Number(process.env.INCIDENT_ARM_MIN_HITS ?? 4)
export const ARM_MIN_CONFIDENCE = Number(process.env.INCIDENT_ARM_MIN_CONFIDENCE ?? 0.78)
export const ARM_MIN_CONSISTENCY = Number(process.env.INCIDENT_ARM_MIN_CONSISTENCY ?? 0.66)
export const RECURRENCE_WINDOW_DAYS = Number(process.env.INCIDENT_RECURRENCE_WINDOW_DAYS ?? 120)

// ============================================================================
//  Pure helpers (no DB -- unit-tested in __tests__/incident-learning.test.ts)
// ============================================================================

export const SEVERITY_SCALE: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }
const SCALE_TO_SEVERITY: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' }
/** Expected guest-impact band (0-10) for a triage severity. */
export const SEVERITY_TO_IMPACT: Record<string, number> = { low: 2, medium: 4, high: 7, critical: 9 }

export function severityScale(severity?: string | null): number {
  return SEVERITY_SCALE[(severity || '').toLowerCase()] ?? 0
}

export function scaleToSeverity(scale: number): string {
  const clamped = Math.max(1, Math.min(4, Math.round(scale)))
  return SCALE_TO_SEVERITY[clamped]
}

/** Normalise a category token for keys: lowercased, spaces->underscore. */
export function normaliseCategory(category?: string | null): string {
  return (category || 'uncategorised').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'uncategorised'
}

export interface OutcomeSignals {
  cost?: number | null
  guestImpactScore?: number | null
  guestMentions?: number | null
  resolutionHours?: number | null
}

/**
 * Derive the ACTUAL severity a resolved incident turned out to be, from realised
 * multi-source signals. This is deliberately independent of the triage severity
 * so predicted-vs-actual carries real information.
 *
 * Points: cost (James), guest impact + mentions (Iris), drag-on time (Hugo).
 */
export function actualSeverityFromSignals(s: OutcomeSignals): { severity: string; score: number } {
  let pts = 0
  const cost = s.cost ?? 0
  if (cost >= 500) pts += 2
  else if (cost >= 150) pts += 1

  const gi = s.guestImpactScore ?? 0
  if (gi >= 8) pts += 2
  else if (gi >= 5) pts += 1

  const gm = s.guestMentions ?? 0
  if (gm >= 3) pts += 1

  const rh = s.resolutionHours ?? 0
  if (rh >= 120) pts += 1 // dragged > 5 days

  // 0 pts -> low, 1 -> medium, 2-3 -> high, 4+ -> critical
  let severity: string
  if (pts >= 4) severity = 'critical'
  else if (pts >= 2) severity = 'high'
  else if (pts >= 1) severity = 'medium'
  else severity = 'low'
  return { severity, score: pts }
}

export function classifyAccuracy(severityDelta: number): 'accurate' | 'under_predicted' | 'over_predicted' {
  if (severityDelta === 0) return 'accurate'
  return severityDelta > 0 ? 'under_predicted' : 'over_predicted'
}

export function median(values: number[]): number | null {
  const xs = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
}

/** Monotonic confidence from hit count: 3 -> 0.75, 4 -> 0.80, 8 -> 0.89. */
export function confidenceFor(hits: number, consistency: number): number {
  if (hits <= 0) return 0
  const base = hits / (hits + 1)
  return Math.min(0.99, Number((base * (0.5 + 0.5 * consistency)).toFixed(4)))
}

export interface OutcomeRow {
  incident_id: number
  property_id: string
  category: string | null
  actual_severity: string | null
  actual_impact_score: number | null
  severity_delta: number | null
  recurrence_days: number | null
}

export interface RuleCandidate {
  scope_type: 'property_category' | 'category'
  property_id: string | null
  category: string
  pattern_key: string
  predicted_severity: string
  predicted_impact_score: number
  recurs_within_days: number | null
  recurrence_rate: number
  hits: number
  consistency: number
  confidence: number
  status: 'shadow' | 'armed'
  rationale: string
  evidence: number[]
}

/**
 * Aggregate resolved outcomes into rule candidates. Builds both a
 * property+category rule and a category-wide rule per group, gated by min-hits.
 * Pure: takes the rows, returns candidates (the DB layer persists + respects
 * manual overrides).
 */
export function buildRuleCandidates(rows: OutcomeRow[], minHits = LEARN_MIN_HITS): RuleCandidate[] {
  const groups = new Map<string, { property_id: string | null; category: string; scope: 'property_category' | 'category'; rows: OutcomeRow[] }>()

  const push = (key: string, property_id: string | null, category: string, scope: 'property_category' | 'category', r: OutcomeRow) => {
    const g = groups.get(key) || { property_id, category, scope, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }

  for (const r of rows) {
    const cat = normaliseCategory(r.category)
    push(`${cat}@${r.property_id}`, r.property_id, cat, 'property_category', r)
    push(`${cat}@*`, null, cat, 'category', r)
  }

  const candidates: RuleCandidate[] = []
  for (const g of groups.values()) {
    const rs = g.rows
    if (rs.length < minHits) continue

    // Dominant actual severity bucket -> the prediction.
    const counts = new Map<string, number>()
    for (const r of rs) {
      const sev = (r.actual_severity || '').toLowerCase()
      if (!sev) continue
      counts.set(sev, (counts.get(sev) || 0) + 1)
    }
    if (counts.size === 0) continue
    let domSev = 'low'
    let domCount = 0
    for (const [sev, c] of counts) {
      if (c > domCount) { domSev = sev; domCount = c }
    }
    const consistency = Number((domCount / rs.length).toFixed(4))

    const impacts = rs.map((r) => r.actual_impact_score ?? SEVERITY_TO_IMPACT[r.actual_severity || 'low'] ?? 0)
    const meanImpact = Math.round(impacts.reduce((a, b) => a + b, 0) / impacts.length)

    const recurrences = rs.map((r) => r.recurrence_days).filter((d): d is number => d != null)
    const recurrenceRate = Number((recurrences.length / rs.length).toFixed(4))
    const medianRecurrence = recurrenceRate >= 0.5 ? median(recurrences) : null

    const confidence = confidenceFor(rs.length, consistency)
    const armEligible =
      rs.length >= ARM_MIN_HITS && confidence >= ARM_MIN_CONFIDENCE && consistency >= ARM_MIN_CONSISTENCY
    const status: 'shadow' | 'armed' = armEligible ? 'armed' : 'shadow'

    const where = g.property_id ? `at ${g.property_id}` : 'across the portfolio'
    const recurBit = medianRecurrence != null ? `, recurs within ~${medianRecurrence} days` : ''
    const rationale =
      `${g.category} ${where} = usually ${domSev} (impact ~${meanImpact}/10)${recurBit}. ` +
      `Based on ${rs.length} resolved incidents (${Math.round(consistency * 100)}% agree).`

    candidates.push({
      scope_type: g.scope,
      property_id: g.property_id,
      category: g.category,
      pattern_key: g.property_id ? `${g.category}@${g.property_id}` : `${g.category}@*`,
      predicted_severity: domSev,
      predicted_impact_score: meanImpact,
      recurs_within_days: medianRecurrence,
      recurrence_rate: recurrenceRate,
      hits: rs.length,
      consistency,
      confidence,
      status,
      rationale,
      evidence: rs.map((r) => r.incident_id),
    })
  }

  // Most specific + most confident first.
  candidates.sort((a, b) => {
    if (a.scope_type !== b.scope_type) return a.scope_type === 'property_category' ? -1 : 1
    return b.confidence - a.confidence
  })
  return candidates
}

export interface Prediction {
  predicted_severity: string
  predicted_impact_score: number
  recurs_within_days: number | null
  confidence: number
  rule_id: number
  source: 'armed' | 'shadow'
  rationale: string
}

/** Pick the best rule (most specific, then most confident) for a property+category. */
export function pickBestRule<T extends { scope_type: string; property_id: string | null; category: string; confidence: number; status: string }>(
  rules: T[],
  propertyId: string,
  category: string,
): T | null {
  const cat = normaliseCategory(category)
  const matches = rules.filter(
    (r) => r.status !== 'rejected' && r.category === cat && (r.property_id === propertyId || r.property_id == null),
  )
  matches.sort((a, b) => {
    const aSpec = a.property_id === propertyId ? 0 : 1
    const bSpec = b.property_id === propertyId ? 0 : 1
    if (aSpec !== bSpec) return aSpec - bSpec
    // armed beats shadow at equal specificity
    if (a.status !== b.status) return a.status === 'armed' ? -1 : 1
    return b.confidence - a.confidence
  })
  return matches[0] || null
}

// ============================================================================
//  DB layer
// ============================================================================

const DAY_SECONDS = 86400

/** Parse a YYYY-MM-DD or unix-seconds value into unix seconds. */
function toUnix(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value > 1e11 ? Math.floor(value / 1000) : value
  const s = String(value).trim()
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n > 1e11 ? Math.floor(n / 1000) : n
  }
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

interface IncidentRow {
  id: number
  property_id: string
  date: string
  category: string | null
  severity: string | null
  status: string | null
  resolved_date: number | null
  cost: number | null
  guest_impact_score: number | null
  guest_mentions: number | null
  predicted_severity: string | null
  predicted_impact_score: number | null
  workspace_id: number
}

function getIncident(db: Database.Database, id: number): IncidentRow | undefined {
  return db.prepare(`SELECT * FROM property_incidents WHERE id = ?`).get(id) as IncidentRow | undefined
}

/**
 * CAPTURE -- snapshot the triage prediction onto a freshly created incident.
 * If an ARMED rule matches and the incident has no severity yet, apply it.
 * Returns the prediction used (if any) for logging.
 */
export function onIncidentCreated(db: Database.Database, incidentId: number): Prediction | null {
  const inc = getIncident(db, incidentId)
  if (!inc) return null

  let prediction: Prediction | null = null
  try {
    prediction = predictForIncident(db, inc.property_id, inc.category, inc.workspace_id)
  } catch {
    prediction = null
  }

  // Triage severity is the human/Hugo call; fall back to an armed rule's prediction.
  let predictedSeverity = inc.severity
  if (!predictedSeverity && prediction?.source === 'armed') predictedSeverity = prediction.predicted_severity

  const predictedImpact =
    inc.predicted_impact_score ??
    prediction?.predicted_impact_score ??
    (predictedSeverity ? SEVERITY_TO_IMPACT[predictedSeverity.toLowerCase()] : null) ??
    null

  // Apply an armed rule's severity only when the incident was logged without one.
  const applySeverity = !inc.severity && prediction?.source === 'armed' ? prediction.predicted_severity : inc.severity

  db.prepare(
    `UPDATE property_incidents
        SET predicted_severity = ?, predicted_impact_score = ?, prediction_rule_id = ?, prediction_source = ?,
            severity = ?, updated_at = unixepoch()
      WHERE id = ?`,
  ).run(
    predictedSeverity ?? null,
    predictedImpact,
    prediction?.rule_id ?? null,
    prediction?.source ?? null,
    applySeverity ?? null,
    incidentId,
  )

  return prediction
}

/** Days since the most recent prior incident of the same property+category. */
function recurrenceDays(db: Database.Database, inc: IncidentRow): number | null {
  const thisDate = toUnix(inc.date)
  if (thisDate == null) return null
  const prior = db
    .prepare(
      `SELECT date FROM property_incidents
        WHERE property_id = ? AND workspace_id = ?
          AND lower(COALESCE(category,'')) = lower(COALESCE(?,''))
          AND id <> ?
        ORDER BY date DESC`,
    )
    .all(inc.property_id, inc.workspace_id, inc.category, inc.id) as Array<{ date: string }>
  for (const p of prior) {
    const pd = toUnix(p.date)
    if (pd == null || pd >= thisDate) continue
    const days = Math.round((thisDate - pd) / DAY_SECONDS)
    if (days <= RECURRENCE_WINDOW_DAYS) return days
    return null // most recent prior is already outside the window
  }
  return null
}

/**
 * OUTCOME -- called when an incident is resolved. Computes actual vs predicted
 * and upserts an incident_outcomes row. Idempotent (UNIQUE on incident_id).
 */
export function onIncidentResolved(db: Database.Database, incidentId: number): OutcomeRow | null {
  const inc = getIncident(db, incidentId)
  if (!inc) return null

  const resolvedAt = inc.resolved_date ?? null
  const startedAt = toUnix(inc.date)
  const resolutionHours =
    resolvedAt != null && startedAt != null && resolvedAt >= startedAt
      ? Number(((resolvedAt - startedAt) / 3600).toFixed(2))
      : null

  const { severity: actualSeverity, score: actualImpactPts } = actualSeverityFromSignals({
    cost: inc.cost,
    guestImpactScore: inc.guest_impact_score,
    guestMentions: inc.guest_mentions,
    resolutionHours,
  })
  const actualImpact = inc.guest_impact_score ?? SEVERITY_TO_IMPACT[actualSeverity]

  const predictedSeverity = inc.predicted_severity || inc.severity || null
  const predictedImpact =
    inc.predicted_impact_score ?? (predictedSeverity ? SEVERITY_TO_IMPACT[predictedSeverity.toLowerCase()] : null)

  const severityDelta =
    predictedSeverity != null ? severityScale(actualSeverity) - severityScale(predictedSeverity) : null
  const impactDelta = predictedImpact != null ? actualImpact - predictedImpact : null
  const accuracy = severityDelta != null ? classifyAccuracy(severityDelta) : null

  const recurrence = recurrenceDays(db, inc)
  void actualImpactPts

  db.prepare(
    `INSERT INTO incident_outcomes (
        incident_id, property_id, category,
        predicted_severity, predicted_impact_score, actual_severity, actual_impact_score,
        severity_delta, impact_delta, accuracy,
        predicted_cost, actual_cost, cost_delta,
        resolution_hours, recurrence_days, workspace_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(incident_id) DO UPDATE SET
        category = excluded.category,
        predicted_severity = excluded.predicted_severity,
        predicted_impact_score = excluded.predicted_impact_score,
        actual_severity = excluded.actual_severity,
        actual_impact_score = excluded.actual_impact_score,
        severity_delta = excluded.severity_delta,
        impact_delta = excluded.impact_delta,
        accuracy = excluded.accuracy,
        actual_cost = excluded.actual_cost,
        resolution_hours = excluded.resolution_hours,
        recurrence_days = excluded.recurrence_days`,
  ).run(
    inc.id,
    inc.property_id,
    inc.category,
    predictedSeverity,
    predictedImpact,
    actualSeverity,
    actualImpact,
    severityDelta,
    impactDelta,
    accuracy,
    null,
    inc.cost ?? null,
    null,
    resolutionHours,
    recurrence,
    inc.workspace_id,
  )

  return {
    incident_id: inc.id,
    property_id: inc.property_id,
    category: inc.category,
    actual_severity: actualSeverity,
    actual_impact_score: actualImpact,
    severity_delta: severityDelta,
    recurrence_days: recurrence,
  }
}

/** CONSUME -- best learned prediction for a new incident's property+category. */
export function predictForIncident(
  db: Database.Database,
  propertyId: string,
  category: string | null,
  workspaceId = 1,
): Prediction | null {
  const cat = normaliseCategory(category)
  const rules = db
    .prepare(
      `SELECT id, scope_type, property_id, category, predicted_severity, predicted_impact_score,
              recurs_within_days, confidence, status, rationale
         FROM learned_scoring_rules
        WHERE workspace_id = ? AND status IN ('armed','shadow') AND category = ?`,
    )
    .all(workspaceId, cat) as Array<{
    id: number
    scope_type: string
    property_id: string | null
    category: string
    predicted_severity: string
    predicted_impact_score: number
    recurs_within_days: number | null
    confidence: number
    status: string
    rationale: string
  }>

  const best = pickBestRule(rules, propertyId, cat)
  if (!best) return null
  return {
    predicted_severity: best.predicted_severity,
    predicted_impact_score: best.predicted_impact_score,
    recurs_within_days: best.recurs_within_days,
    confidence: best.confidence,
    rule_id: best.id,
    source: best.status === 'armed' ? 'armed' : 'shadow',
    rationale: best.rationale,
  }
}

export interface LearnStats {
  outcomes: number
  candidates: number
  upserted: number
  armed: number
  shadow: number
}

/**
 * PROMOTE -- aggregate outcomes into learned rules. Auto-arms eligible rules but
 * never overrides a rule a human set (status_source='manual'). Refreshes the
 * prediction_accuracy snapshots.
 */
export function learnRules(db: Database.Database, workspaceId = 1): LearnStats {
  const rows = db
    .prepare(
      `SELECT incident_id, property_id, category, actual_severity, actual_impact_score, severity_delta, recurrence_days
         FROM incident_outcomes WHERE workspace_id = ?`,
    )
    .all(workspaceId) as OutcomeRow[]

  const stats: LearnStats = { outcomes: rows.length, candidates: 0, upserted: 0, armed: 0, shadow: 0 }
  const candidates = buildRuleCandidates(rows)
  stats.candidates = candidates.length

  const now = Math.floor(Date.now() / 1000)
  const selectExisting = db.prepare(
    `SELECT id, status, status_source FROM learned_scoring_rules WHERE pattern_key = ? AND workspace_id = ?`,
  )

  const upsert = db.transaction(() => {
    for (const c of candidates) {
      const existing = selectExisting.get(c.pattern_key, workspaceId) as
        | { id: number; status: string; status_source: string }
        | undefined

      // Respect a human decision; the auto pass only manages 'system' rules.
      const status = existing && existing.status_source === 'manual' ? existing.status : c.status

      if (existing) {
        db.prepare(
          `UPDATE learned_scoring_rules SET
              scope_type=?, property_id=?, category=?, predicted_severity=?, predicted_impact_score=?,
              recurs_within_days=?, recurrence_rate=?, hits=?, consistency=?, confidence=?,
              status=?, rationale=?, evidence=?, last_learned_at=?, updated_at=?
            WHERE id=?`,
        ).run(
          c.scope_type, c.property_id, c.category, c.predicted_severity, c.predicted_impact_score,
          c.recurs_within_days, c.recurrence_rate, c.hits, c.consistency, c.confidence,
          status, c.rationale, JSON.stringify(c.evidence), now, now, existing.id,
        )
      } else {
        db.prepare(
          `INSERT INTO learned_scoring_rules
             (scope_type, property_id, category, pattern_key, predicted_severity, predicted_impact_score,
              recurs_within_days, recurrence_rate, hits, consistency, confidence, status, status_source,
              rationale, evidence, last_learned_at, created_at, updated_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?, ?, ?, ?, ?)`,
        ).run(
          c.scope_type, c.property_id, c.category, c.pattern_key, c.predicted_severity, c.predicted_impact_score,
          c.recurs_within_days, c.recurrence_rate, c.hits, c.consistency, c.confidence, status,
          c.rationale, JSON.stringify(c.evidence), now, now, now, workspaceId,
        )
      }
      stats.upserted++
      if (status === 'armed') stats.armed++
      else if (status === 'shadow') stats.shadow++
    }
    refreshPredictionAccuracy(db, rows, workspaceId, now)
  })
  upsert()

  return stats
}

function refreshPredictionAccuracy(db: Database.Database, rows: OutcomeRow[], workspaceId: number, now: number): void {
  const scopes = new Map<string, OutcomeRow[]>()
  const add = (scope: string, r: OutcomeRow) => {
    const l = scopes.get(scope) || []
    l.push(r)
    scopes.set(scope, l)
  }
  for (const r of rows) {
    if (r.severity_delta == null) continue
    add('overall', r)
    add(`category:${normaliseCategory(r.category)}`, r)
    add(`property:${r.property_id}`, r)
  }

  const upsert = db.prepare(
    `INSERT INTO prediction_accuracy
       (scope, n, accurate, under_predicted, over_predicted, accuracy_rate, mean_abs_severity_delta, mean_abs_impact_delta, computed_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, workspace_id) DO UPDATE SET
       n=excluded.n, accurate=excluded.accurate, under_predicted=excluded.under_predicted,
       over_predicted=excluded.over_predicted, accuracy_rate=excluded.accuracy_rate,
       mean_abs_severity_delta=excluded.mean_abs_severity_delta, computed_at=excluded.computed_at`,
  )

  for (const [scope, rs] of scopes) {
    const n = rs.length
    let accurate = 0
    let under = 0
    let over = 0
    let absSum = 0
    for (const r of rs) {
      const d = r.severity_delta ?? 0
      absSum += Math.abs(d)
      const cls = classifyAccuracy(d)
      if (cls === 'accurate') accurate++
      else if (cls === 'under_predicted') under++
      else over++
    }
    upsert.run(
      scope, n, accurate, under, over,
      Number((accurate / n).toFixed(4)),
      Number((absSum / n).toFixed(4)),
      null, now, workspaceId,
    )
  }
}

// ---- Dashboard aggregation ----

export interface LearningDashboard {
  rules: any[]
  accuracy: any[]
  interventions: any[]
  summary: {
    resolved_with_outcome: number
    accurate: number
    under_predicted: number
    over_predicted: number
    accuracy_rate: number
    armed_rules: number
    shadow_rules: number
    recurring_patterns: number
  }
}

export function getLearningDashboard(db: Database.Database, workspaceId = 1): LearningDashboard {
  const rules = db
    .prepare(
      `SELECT * FROM learned_scoring_rules WHERE workspace_id = ?
        ORDER BY (status='armed') DESC, confidence DESC, hits DESC`,
    )
    .all(workspaceId) as any[]
  for (const r of rules) {
    try { r.evidence = r.evidence ? JSON.parse(r.evidence) : [] } catch { r.evidence = [] }
  }

  const accuracy = db
    .prepare(`SELECT * FROM prediction_accuracy WHERE workspace_id = ? ORDER BY scope = 'overall' DESC, n DESC`)
    .all(workspaceId) as any[]

  const interventions = db
    .prepare(
      `SELECT intervention_type,
              COUNT(*) AS attempts,
              SUM(COALESCE(success,0)) AS successes,
              SUM(recurred) AS recurrences,
              ROUND(AVG(resolution_hours), 1) AS avg_resolution_hours,
              ROUND(AVG(cost), 2) AS avg_cost
         FROM intervention_outcomes
        WHERE workspace_id = ?
        GROUP BY intervention_type
        ORDER BY successes DESC, attempts DESC`,
    )
    .all(workspaceId) as any[]
  for (const i of interventions) {
    i.success_rate = i.attempts ? Number((i.successes / i.attempts).toFixed(2)) : 0
  }

  const overall = (accuracy.find((a) => a.scope === 'overall') as any) || {}
  const summary = {
    resolved_with_outcome: (db.prepare(`SELECT COUNT(*) c FROM incident_outcomes WHERE workspace_id = ?`).get(workspaceId) as any).c,
    accurate: overall.accurate ?? 0,
    under_predicted: overall.under_predicted ?? 0,
    over_predicted: overall.over_predicted ?? 0,
    accuracy_rate: overall.accuracy_rate ?? 0,
    armed_rules: rules.filter((r) => r.status === 'armed').length,
    shadow_rules: rules.filter((r) => r.status === 'shadow').length,
    recurring_patterns: rules.filter((r) => r.recurs_within_days != null).length,
  }

  return { rules, accuracy, interventions, summary }
}
