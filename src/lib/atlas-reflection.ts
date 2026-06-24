/**
 * Atlas self-improvement loop — weekly reflection + coordination-rule learning.
 *
 * Atlas (Chief of Staff) reflects on the fleet each week, proposes coordination
 * rules to smooth hand-offs/escalations, and measures whether each change moved
 * its target metric — auto-arming winners and retiring losers over time.
 *
 * Modelled on Sofia's correctionLearner and MC's own incident learning loop
 * (`incident-learning.ts`): shadow -> armed promotion, gated on
 * applied-count + success-rate + confidence, and the automatic pass NEVER
 * overrides a human decision (status_source = 'manual').
 *
 *   MEASURE   measureExperiments: score each active rule's target metric for the
 *             week, compare to its baseline, update the scorecard, auto-arm /
 *             auto-retire.
 *   COLLECT   collectWeekData: assemble briefings, task outcomes, hand-offs /
 *             escalations, and incidents for the week.
 *   REFLECT   callClaudeForReflection (with a deterministic heuristic fallback)
 *             -> prose + insights + bottlenecks + recommended rules.
 *   LEARN     upsertRecommendedRules: persist proposals as shadow rules with a
 *             hypothesis + metric + baseline, and open a running experiment.
 *
 * Everything above the "DB layer" banner is DB-free and unit-tested.
 */
import type Database from 'better-sqlite3'
import { db_helpers } from './db'
import { logger } from './logger'
import { callAnthropic } from './anthropic'

// ---- Config (env-overridable, matches the incident loop's gating philosophy) ----

export const ARM_MIN_APPLIED = Number(process.env.ATLAS_ARM_MIN_APPLIED ?? 3)
export const ARM_MIN_SUCCESS_RATE = Number(process.env.ATLAS_ARM_MIN_SUCCESS_RATE ?? 0.6)
export const ARM_MIN_CONFIDENCE = Number(process.env.ATLAS_ARM_MIN_CONFIDENCE ?? 0.7)
export const RETIRE_MIN_APPLIED = Number(process.env.ATLAS_RETIRE_MIN_APPLIED ?? 4)
export const RETIRE_MAX_SUCCESS_RATE = Number(process.env.ATLAS_RETIRE_MAX_SUCCESS_RATE ?? 0.34)

const DAY_SECONDS = 86400
const WEEK_SECONDS = 7 * DAY_SECONDS

export type MetricDirection = 'lower_is_better' | 'higher_is_better'

/** Metrics Atlas can measure from existing tables. Unknown metrics -> null result. */
export const KNOWN_METRICS: Record<string, MetricDirection> = {
  time_to_resolution: 'lower_is_better',
  task_completion_rate: 'higher_is_better',
  task_blocked_rate: 'lower_is_better',
  cost_prediction_accuracy: 'higher_is_better',
  escalation_volume: 'lower_is_better',
}

// ============================================================================
//  Pure helpers (no DB -- unit-tested in __tests__/atlas-reflection.test.ts)
// ============================================================================

/** Monday (UTC, YYYY-MM-DD) of the week containing `ms`. */
export function weekStart(ms: number): string {
  const d = new Date(ms)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - deltaToMonday))
  return monday.toISOString().split('T')[0]
}

/** Unix-second [start, end) for a YYYY-MM-DD week-of (Monday) string. */
export function weekRange(weekOf: string): { start: number; end: number } {
  const start = Math.floor(new Date(`${weekOf}T00:00:00Z`).getTime() / 1000)
  return { start, end: start + WEEK_SECONDS }
}

/** Previous week's Monday string. */
export function previousWeekOf(weekOf: string): string {
  const { start } = weekRange(weekOf)
  return weekStart((start - DAY_SECONDS) * 1000)
}

/** Stable slug for a rule, used for dedup across weeks. */
export function slugifyRuleKey(s: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'rule'
}

/** Monotonic confidence from weeks-applied + success-rate: 3 -> ~0.6, 6 -> ~0.77. */
export function confidenceForRule(appliedCount: number, successRate: number): number {
  if (appliedCount <= 0) return 0
  const base = appliedCount / (appliedCount + 2)
  return Math.min(0.99, Number((base * (0.4 + 0.6 * successRate)).toFixed(4)))
}

/** Signed improvement toward the goal + a verdict. Null inputs -> inconclusive. */
export function experimentVerdict(
  baseline: number | null | undefined,
  result: number | null | undefined,
  direction: MetricDirection,
  epsilon = 1e-6,
): { impact: number | null; verdict: 'improved' | 'no_change' | 'worsened' | 'inconclusive' } {
  if (baseline == null || result == null || Number.isNaN(baseline) || Number.isNaN(result)) {
    return { impact: null, verdict: 'inconclusive' }
  }
  const impact = direction === 'lower_is_better' ? baseline - result : result - baseline
  if (impact > epsilon) return { impact: Number(impact.toFixed(4)), verdict: 'improved' }
  if (impact < -epsilon) return { impact: Number(impact.toFixed(4)), verdict: 'worsened' }
  return { impact: 0, verdict: 'no_change' }
}

/** Arm gate: enough measured weeks, a winning rate, and confidence. */
export function armEligible(r: { applied_count: number; success_rate: number; confidence: number }): boolean {
  return r.applied_count >= ARM_MIN_APPLIED && r.success_rate >= ARM_MIN_SUCCESS_RATE && r.confidence >= ARM_MIN_CONFIDENCE
}

/** Retire gate: applied enough times and clearly not working. */
export function retireEligible(r: { applied_count: number; success_rate: number }): boolean {
  return r.applied_count >= RETIRE_MIN_APPLIED && r.success_rate <= RETIRE_MAX_SUCCESS_RATE
}

export interface RecommendedRule {
  title: string
  trigger_event: string
  condition?: string | null
  then_action: string
  target_agent?: string | null
  hypothesis?: string | null
  metric?: string | null
  rationale?: string | null
}

/** Coerce arbitrary parsed JSON into a clean RecommendedRule (drops junk). */
export function normaliseRecommendedRule(raw: any): RecommendedRule | null {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title || raw.name || '').trim()
  const trigger = String(raw.trigger_event || raw.trigger || raw.when || '').trim()
  const action = String(raw.then_action || raw.action || raw.then || '').trim()
  if (!title || !trigger || !action) return null
  const metric = raw.metric ? String(raw.metric).trim() : null
  return {
    title: title.slice(0, 200),
    trigger_event: trigger.slice(0, 300),
    condition: raw.condition ? String(raw.condition).slice(0, 300) : null,
    then_action: action.slice(0, 400),
    target_agent: raw.target_agent ? String(raw.target_agent).slice(0, 80) : null,
    hypothesis: raw.hypothesis ? String(raw.hypothesis).slice(0, 600) : null,
    metric: metric && metric in KNOWN_METRICS ? metric : metric, // keep even if unknown; measured as inconclusive
    rationale: raw.rationale ? String(raw.rationale).slice(0, 600) : null,
  }
}

export interface ParsedReflection {
  reflection: string
  insights: string[]
  handoffs: { worked: string[]; broke: string[] }
  bottlenecks: string[]
  recommended_rules: RecommendedRule[]
}

/** Extract the first balanced top-level JSON object from a model response. */
function extractJsonBlock(text: string): any | null {
  if (!text) return null
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

const asStringArray = (v: any): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean).slice(0, 50) : []

/** Parse Claude's reflection response. Falls back to treating the text as prose. */
export function parseReflectionResponse(text: string): ParsedReflection {
  const json = extractJsonBlock(text)
  if (json) {
    const rules = Array.isArray(json.recommended_rules) ? json.recommended_rules : []
    return {
      reflection: String(json.reflection || json.summary || text || '').trim(),
      insights: asStringArray(json.insights),
      handoffs: {
        worked: asStringArray(json.handoffs?.worked ?? json.handoffs_worked),
        broke: asStringArray(json.handoffs?.broke ?? json.handoffs?.broke_down ?? json.handoffs_broke),
      },
      bottlenecks: asStringArray(json.bottlenecks),
      recommended_rules: rules.map(normaliseRecommendedRule).filter((r: RecommendedRule | null): r is RecommendedRule => r != null),
    }
  }
  return { reflection: (text || '').trim(), insights: [], handoffs: { worked: [], broke: [] }, bottlenecks: [], recommended_rules: [] }
}

export interface WeekData {
  week_of: string
  briefings: Array<{ agent_name: string; date: string; metrics: any }>
  tasks: {
    completed: number
    created: number
    overdue: number
    stalled: number
    completion_rate: number
    blocked_rate: number
    by_agent: Array<{ agent: string; completed: number; overdue: number; stalled: number }>
  }
  handoffs: { total: number; by_type: Array<{ type: string; count: number }> }
  escalations: { high_priority_tasks: number; high_severity_incidents: number }
  incidents: {
    total: number
    by_severity: Array<{ severity: string; count: number }>
    resolved: number
    avg_resolution_hours: number | null
  }
  active_rules: Array<{ id: number; title: string; status: string; metric: string | null; success_rate: number; applied_count: number }>
  prior_reflection: { week_of: string; insights: string[] } | null
}

/** Deterministic reflection used when no LLM key is set (loop still runs). */
export function heuristicReflection(d: WeekData): ParsedReflection {
  const insights: string[] = []
  const bottlenecks: string[] = []
  const worked: string[] = []
  const broke: string[] = []
  const rules: RecommendedRule[] = []

  insights.push(
    `${d.tasks.completed} tasks completed, ${d.tasks.created} created; ${Math.round(d.tasks.completion_rate * 100)}% completion rate this week.`,
  )
  if (d.handoffs.total > 0) {
    const top = d.handoffs.by_type[0]
    worked.push(`${d.handoffs.total} hand-offs routed${top ? ` (mostly ${top.type})` : ''}.`)
  }

  if (d.tasks.stalled > 0) {
    bottlenecks.push(`${d.tasks.stalled} task(s) stalled in progress (no update in >2 days).`)
    rules.push({
      title: 'Requeue stalled in-progress tasks faster',
      trigger_event: 'task_stalled_in_progress',
      condition: 'no status update for >48h',
      then_action: 'Atlas requeues the task and pings the assigned agent',
      target_agent: 'Atlas',
      hypothesis: 'Tighter stall detection lowers the blocked rate.',
      metric: 'task_blocked_rate',
      rationale: `${d.tasks.stalled} stalled task(s) observed in ${d.week_of}.`,
    })
  }
  if (d.tasks.overdue > 3) {
    bottlenecks.push(`${d.tasks.overdue} task(s) overdue — due dates slipping.`)
  }
  if (d.escalations.high_severity_incidents > 0 && (d.incidents.avg_resolution_hours ?? 0) > 72) {
    broke.push(`High-severity incidents averaged ${Math.round(d.incidents.avg_resolution_hours ?? 0)}h to resolve.`)
    rules.push({
      title: 'Escalate high-severity incidents to Larry immediately',
      trigger_event: 'incident_severity_high_or_critical',
      condition: 'severity in (high, critical)',
      then_action: 'Notify Larry (landlord relations) in real-time, do not wait for the daily briefing',
      target_agent: 'Larry',
      hypothesis: 'Real-time escalation cuts time-to-resolution on serious incidents.',
      metric: 'time_to_resolution',
      rationale: `Avg resolution ${Math.round(d.incidents.avg_resolution_hours ?? 0)}h in ${d.week_of}.`,
    })
  }

  const reflection =
    `Heuristic weekly reflection for week of ${d.week_of} (no LLM key configured). ` +
    `Completed ${d.tasks.completed}/${d.tasks.completed + d.tasks.overdue + d.tasks.stalled} actionable tasks, ` +
    `${d.handoffs.total} hand-offs, ${d.incidents.total} incidents (${d.incidents.resolved} resolved). ` +
    (bottlenecks.length ? `Bottlenecks: ${bottlenecks.join(' ')}` : 'No major bottlenecks detected.')

  return { reflection, insights, handoffs: { worked, broke }, bottlenecks, recommended_rules: rules }
}

/** Build the reflection prompt fed to Claude. */
export function buildReflectionPrompt(d: WeekData): string {
  return [
    `You are Atlas, the Chief of Staff orchestrating a fleet of AI agents for a London serviced-accommodation business.`,
    `Reflect on the week of ${d.week_of} and propose coordination rules that will make the fleet smoother next week.`,
    ``,
    `THIS WEEK'S DATA (JSON):`,
    JSON.stringify(
      {
        tasks: d.tasks,
        handoffs: d.handoffs,
        escalations: d.escalations,
        incidents: d.incidents,
        briefings: d.briefings,
        active_rules: d.active_rules,
        prior_reflection: d.prior_reflection,
      },
      null,
      2,
    ),
    ``,
    `Consider: which hand-offs worked? which broke down? what bottlenecks emerged? what should change next week?`,
    `Each proposed rule MUST target one measurable metric from this set so we can test it:`,
    Object.keys(KNOWN_METRICS).map((m) => `  - ${m} (${KNOWN_METRICS[m]})`).join('\n'),
    ``,
    `Respond with ONLY a JSON object, no prose outside it, of this exact shape:`,
    `{`,
    `  "reflection": "2-4 paragraph narrative of the week",`,
    `  "insights": ["short pattern", ...],`,
    `  "handoffs": { "worked": ["..."], "broke": ["..."] },`,
    `  "bottlenecks": ["..."],`,
    `  "recommended_rules": [`,
    `    {`,
    `      "title": "short imperative",`,
    `      "trigger_event": "machine-ish trigger token",`,
    `      "condition": "optional qualifier",`,
    `      "then_action": "what Atlas should do",`,
    `      "target_agent": "agent name or null",`,
    `      "hypothesis": "why this helps",`,
    `      "metric": "one of the metrics above",`,
    `      "rationale": "evidence from this week's data"`,
    `    }`,
    `  ]`,
    `}`,
    `Propose at most 3 high-confidence rules. Prefer changing one thing well over many speculative changes.`,
  ].join('\n')
}

// ============================================================================
//  DB layer
// ============================================================================

const num = (v: any): number => (typeof v === 'number' && !Number.isNaN(v) ? v : Number(v) || 0)

/** Distinct workspace ids that have agents (fallback [1]). */
function workspacesWithAgents(db: Database.Database): number[] {
  try {
    const rows = db.prepare('SELECT DISTINCT workspace_id FROM agents').all() as Array<{ workspace_id: number }>
    const ids = rows.map((r) => r.workspace_id ?? 1)
    return ids.length ? ids : [1]
  } catch {
    return [1]
  }
}

/** Assemble the week's data for a workspace. */
export function collectWeekData(db: Database.Database, weekOf: string, workspaceId: number): WeekData {
  const { start, end } = weekRange(weekOf)
  const now = Math.floor(Date.now() / 1000)

  const briefings = db
    .prepare(
      `SELECT agent_name, date, metrics FROM briefings
        WHERE workspace_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC`,
    )
    .all(workspaceId, new Date(start * 1000).toISOString().split('T')[0], new Date((end - 1) * 1000).toISOString().split('T')[0]) as any[]

  const completed = num((db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status = 'done' AND updated_at >= ? AND updated_at < ?`,
  ).get(workspaceId, start, end) as any).c)
  const created = num((db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND created_at >= ? AND created_at < ?`,
  ).get(workspaceId, start, end) as any).c)
  const overdue = num((db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date < ?`,
  ).get(workspaceId, Math.min(end, now)) as any).c)
  const stalled = num((db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status = 'in_progress' AND updated_at < ?`,
  ).get(workspaceId, now - 2 * DAY_SECONDS) as any).c)
  const touched = completed + overdue + stalled
  const completion_rate = touched > 0 ? Number((completed / touched).toFixed(4)) : 0
  const blocked_rate = touched > 0 ? Number(((overdue + stalled) / touched).toFixed(4)) : 0

  const byAgent = db
    .prepare(
      `SELECT assigned_to AS agent,
              SUM(CASE WHEN status='done' AND updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status!='done' AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN status='in_progress' AND updated_at < ? THEN 1 ELSE 0 END) AS stalled
         FROM tasks
        WHERE workspace_id = ? AND assigned_to IS NOT NULL
        GROUP BY assigned_to
       HAVING completed > 0 OR overdue > 0 OR stalled > 0
        ORDER BY completed DESC
        LIMIT 25`,
    )
    .all(start, end, Math.min(end, now), now - 2 * DAY_SECONDS, workspaceId) as any[]

  const handoffTypes = ['task_auto_routed', 'task_dispatched_atlas', 'task_autodispatch_shadow', 'agent_status_change']
  const handoffRows = db
    .prepare(
      `SELECT type, COUNT(*) c FROM activities
        WHERE created_at >= ? AND created_at < ? AND type IN (${handoffTypes.map(() => '?').join(',')})
        GROUP BY type ORDER BY c DESC`,
    )
    .all(start, end, ...handoffTypes) as any[]
  const handoffTotal = handoffRows.reduce((a, r) => a + num(r.c), 0)

  const highPriorityTasks = num((db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND priority IN ('urgent','high') AND created_at >= ? AND created_at < ?`,
  ).get(workspaceId, start, end) as any).c)

  let incidentsBySeverity: any[] = []
  let incidentsTotal = 0
  let highSevIncidents = 0
  let resolved = 0
  let avgResolutionHours: number | null = null
  try {
    incidentsBySeverity = db
      .prepare(
        `SELECT COALESCE(severity,'unknown') severity, COUNT(*) count FROM property_incidents
          WHERE workspace_id = ? AND date >= ? AND date <= ?
          GROUP BY severity`,
      )
      .all(workspaceId, new Date(start * 1000).toISOString().split('T')[0], new Date((end - 1) * 1000).toISOString().split('T')[0]) as any[]
    incidentsTotal = incidentsBySeverity.reduce((a, r) => a + num(r.count), 0)
    highSevIncidents = incidentsBySeverity.filter((r) => r.severity === 'high' || r.severity === 'critical').reduce((a, r) => a + num(r.count), 0)
    const outc = db.prepare(
      `SELECT COUNT(*) n, AVG(resolution_hours) avg_h FROM incident_outcomes WHERE workspace_id = ? AND created_at >= ? AND created_at < ?`,
    ).get(workspaceId, start, end) as any
    resolved = num(outc?.n)
    avgResolutionHours = outc?.avg_h != null ? Number(num(outc.avg_h).toFixed(2)) : null
  } catch { /* incident tables may not exist in older DBs */ }

  let activeRules: any[] = []
  try {
    activeRules = db
      .prepare(
        `SELECT id, title, status, metric, success_rate, applied_count FROM atlas_coordination_rules
          WHERE workspace_id = ? AND status IN ('shadow','armed') ORDER BY status='armed' DESC, confidence DESC LIMIT 50`,
      )
      .all(workspaceId) as any[]
  } catch { /* table created in same migration; safe-guard */ }

  let priorReflection: { week_of: string; insights: string[] } | null = null
  try {
    const pr = db
      .prepare(
        `SELECT week_of, insights FROM atlas_weekly_reflections
          WHERE workspace_id = ? AND week_of < ? ORDER BY week_of DESC LIMIT 1`,
      )
      .get(workspaceId, weekOf) as any
    if (pr) {
      let ins: string[] = []
      try { ins = pr.insights ? JSON.parse(pr.insights) : [] } catch { ins = [] }
      priorReflection = { week_of: pr.week_of, insights: ins }
    }
  } catch { /* none yet */ }

  return {
    week_of: weekOf,
    briefings: briefings.map((b) => ({ agent_name: b.agent_name, date: b.date, metrics: safeJson(b.metrics) })),
    tasks: {
      completed,
      created,
      overdue,
      stalled,
      completion_rate,
      blocked_rate,
      by_agent: byAgent.map((r) => ({ agent: r.agent, completed: num(r.completed), overdue: num(r.overdue), stalled: num(r.stalled) })),
    },
    handoffs: { total: handoffTotal, by_type: handoffRows.map((r) => ({ type: r.type, count: num(r.c) })) },
    escalations: { high_priority_tasks: highPriorityTasks, high_severity_incidents: highSevIncidents },
    incidents: { total: incidentsTotal, by_severity: incidentsBySeverity, resolved, avg_resolution_hours: avgResolutionHours },
    active_rules: activeRules.map((r) => ({
      id: r.id, title: r.title, status: r.status, metric: r.metric, success_rate: num(r.success_rate), applied_count: num(r.applied_count),
    })),
    prior_reflection: priorReflection,
  }
}

function safeJson(v: any): any {
  if (v == null) return null
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

/** Measure a single metric for a week. Returns null if not computable. */
export function measureMetric(db: Database.Database, metric: string | null, weekOf: string, workspaceId: number): number | null {
  if (!metric) return null
  const { start, end } = weekRange(weekOf)
  const now = Math.floor(Date.now() / 1000)
  try {
    switch (metric) {
      case 'time_to_resolution': {
        const r = db.prepare(
          `SELECT AVG(resolution_hours) v FROM incident_outcomes WHERE workspace_id = ? AND created_at >= ? AND created_at < ? AND resolution_hours IS NOT NULL`,
        ).get(workspaceId, start, end) as any
        return r?.v != null ? Number(num(r.v).toFixed(2)) : null
      }
      case 'task_completion_rate':
      case 'task_blocked_rate': {
        const completed = num((db.prepare(`SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status='done' AND updated_at >= ? AND updated_at < ?`).get(workspaceId, start, end) as any).c)
        const overdue = num((db.prepare(`SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status!='done' AND due_date IS NOT NULL AND due_date < ?`).get(workspaceId, Math.min(end, now)) as any).c)
        const stalled = num((db.prepare(`SELECT COUNT(*) c FROM tasks WHERE workspace_id = ? AND status='in_progress' AND updated_at < ?`).get(workspaceId, now - 2 * DAY_SECONDS) as any).c)
        const touched = completed + overdue + stalled
        if (touched === 0) return null
        return metric === 'task_completion_rate'
          ? Number((completed / touched).toFixed(4))
          : Number(((overdue + stalled) / touched).toFixed(4))
      }
      case 'cost_prediction_accuracy': {
        const r = db.prepare(`SELECT accuracy_rate v FROM prediction_accuracy WHERE workspace_id = ? AND scope='overall'`).get(workspaceId) as any
        return r?.v != null ? Number(num(r.v).toFixed(4)) : null
      }
      case 'escalation_volume': {
        const r = db.prepare(
          `SELECT COUNT(*) c FROM property_incidents WHERE workspace_id = ? AND severity IN ('high','critical') AND date >= ? AND date <= ?`,
        ).get(workspaceId, new Date(start * 1000).toISOString().split('T')[0], new Date((end - 1) * 1000).toISOString().split('T')[0]) as any
        return num(r?.c)
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

export interface MeasureStats { measured: number; armed: number; retired: number; improved: number }

/**
 * MEASURE — score every active rule's metric for the week, upsert an experiment,
 * update the rule scorecard, auto-arm / auto-retire (never overriding manual).
 */
export function measureExperiments(db: Database.Database, weekOf: string, workspaceId: number): MeasureStats {
  const stats: MeasureStats = { measured: 0, armed: 0, retired: 0, improved: 0 }
  const rules = db
    .prepare(`SELECT * FROM atlas_coordination_rules WHERE workspace_id = ? AND status IN ('shadow','armed')`)
    .all(workspaceId) as any[]
  const now = Math.floor(Date.now() / 1000)

  const tx = db.transaction(() => {
    for (const rule of rules) {
      const direction: MetricDirection = (rule.metric_direction as MetricDirection) || KNOWN_METRICS[rule.metric] || 'lower_is_better'
      const result = measureMetric(db, rule.metric, weekOf, workspaceId)
      const baseline = rule.baseline != null ? num(rule.baseline) : result
      const { impact, verdict } = experimentVerdict(baseline, result, direction)

      // Upsert the experiment row for this rule+week.
      db.prepare(
        `INSERT INTO atlas_experiments
           (rule_id, week_of, hypothesis, metric, metric_direction, baseline, result, impact, verdict, status, created_at, updated_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_id, week_of, workspace_id) DO UPDATE SET
           result=excluded.result, impact=excluded.impact, verdict=excluded.verdict,
           baseline=excluded.baseline, status=excluded.status, updated_at=excluded.updated_at`,
      ).run(
        rule.id, weekOf, rule.hypothesis ?? null, rule.metric ?? null, direction,
        baseline ?? null, result ?? null, impact ?? null, verdict,
        verdict === 'inconclusive' ? 'running' : 'completed', now, now, workspaceId,
      )
      stats.measured++

      // Only conclusive measurements move the scorecard.
      if (verdict === 'inconclusive') continue

      const applied_count = num(rule.applied_count) + 1
      const success_count = num(rule.success_count) + (verdict === 'improved' ? 1 : 0)
      const success_rate = Number((success_count / applied_count).toFixed(4))
      const prevAvg = rule.avg_outcome_improvement != null ? num(rule.avg_outcome_improvement) : 0
      const avg_outcome_improvement = Number(
        (((prevAvg * num(rule.applied_count)) + (impact ?? 0)) / applied_count).toFixed(4),
      )
      const confidence = confidenceForRule(applied_count, success_rate)
      if (verdict === 'improved') stats.improved++

      // Capture a baseline on the first conclusive measurement if it had none.
      const newBaseline = rule.baseline != null ? rule.baseline : result

      // Status transitions — system-managed rules only.
      let status = rule.status
      if (rule.status_source !== 'manual') {
        if (status === 'shadow' && armEligible({ applied_count, success_rate, confidence })) {
          status = 'armed'
          stats.armed++
        } else if (retireEligible({ applied_count, success_rate })) {
          status = 'retired'
          stats.retired++
        }
      }

      db.prepare(
        `UPDATE atlas_coordination_rules SET
            applied_count=?, success_count=?, success_rate=?, avg_outcome_improvement=?,
            confidence=?, status=?, baseline=?, last_applied_at=?, updated_at=?
          WHERE id=?`,
      ).run(applied_count, success_count, success_rate, avg_outcome_improvement, confidence, status, newBaseline ?? null, now, now, rule.id)

      if (status === 'retired') {
        db.prepare(`UPDATE atlas_experiments SET status='abandoned', updated_at=? WHERE rule_id=? AND status='running'`).run(now, rule.id)
      }
    }
  })
  tx()
  return stats
}

/** LEARN — persist recommended rules as shadow rules + open running experiments. */
export function upsertRecommendedRules(
  db: Database.Database,
  recs: RecommendedRule[],
  reflectionId: number | null,
  weekOf: string,
  workspaceId: number,
): number[] {
  const ids: number[] = []
  const now = Math.floor(Date.now() / 1000)
  const tx = db.transaction(() => {
    for (const rec of recs) {
      const ruleKey = slugifyRuleKey(rec.title)
      const metric = rec.metric || null
      const direction: MetricDirection = metric && metric in KNOWN_METRICS ? KNOWN_METRICS[metric] : 'lower_is_better'
      const baseline = measureMetric(db, metric, weekOf, workspaceId)

      const existing = db.prepare(
        `SELECT id, status_source FROM atlas_coordination_rules WHERE rule_key = ? AND workspace_id = ?`,
      ).get(ruleKey, workspaceId) as { id: number; status_source: string } | undefined

      let ruleId: number
      if (existing) {
        // Refresh the description fields; leave status + scorecard intact.
        db.prepare(
          `UPDATE atlas_coordination_rules SET
              title=?, trigger_event=?, condition=?, then_action=?, target_agent=?, hypothesis=?,
              metric=?, metric_direction=?, rationale=?, source_reflection_id=COALESCE(source_reflection_id, ?), updated_at=?
            WHERE id=?`,
        ).run(
          rec.title, rec.trigger_event, rec.condition ?? null, rec.then_action, rec.target_agent ?? null, rec.hypothesis ?? null,
          metric, direction, rec.rationale ?? null, reflectionId, now, existing.id,
        )
        ruleId = existing.id
      } else {
        const res = db.prepare(
          `INSERT INTO atlas_coordination_rules
             (rule_key, title, trigger_event, condition, then_action, target_agent, hypothesis, metric, metric_direction,
              baseline, status, status_source, rationale, source_reflection_id, created_at, updated_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shadow', 'system', ?, ?, ?, ?, ?)`,
        ).run(
          ruleKey, rec.title, rec.trigger_event, rec.condition ?? null, rec.then_action, rec.target_agent ?? null, rec.hypothesis ?? null,
          metric, direction, baseline ?? null, rec.rationale ?? null, reflectionId, now, now, workspaceId,
        )
        ruleId = res.lastInsertRowid as number
      }
      ids.push(ruleId)

      // Open a running experiment for the coming week (idempotent on rule+week).
      db.prepare(
        `INSERT INTO atlas_experiments
           (rule_id, week_of, hypothesis, metric, metric_direction, baseline, status, created_at, updated_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
         ON CONFLICT(rule_id, week_of, workspace_id) DO NOTHING`,
      ).run(ruleId, weekOf, rec.hypothesis ?? null, metric, direction, baseline ?? null, now, now, workspaceId)
    }
  })
  tx()
  return ids
}

async function callClaudeForReflection(
  d: WeekData,
  workspaceId: number,
): Promise<{ parsed: ParsedReflection; generatedBy: 'ai' | 'heuristic'; model: string | null; inputTokens: number | null; outputTokens: number | null }> {
  try {
    const res = await callAnthropic({
      system: 'You are Atlas, a Chief of Staff orchestrating an AI agent fleet. You return only valid JSON.',
      messages: [{ role: 'user', content: buildReflectionPrompt(d) }],
      maxTokens: 4096,
      agentName: 'Atlas',
      source: 'atlas-reflection',
      workspaceId,
    })
    if (res) {
      const parsed = parseReflectionResponse(res.text)
      if (parsed.reflection) {
        return { parsed, generatedBy: 'ai', model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Atlas reflection: LLM call failed, falling back to heuristic')
  }
  return { parsed: heuristicReflection(d), generatedBy: 'heuristic', model: null, inputTokens: null, outputTokens: null }
}

export interface ReflectionResult {
  week_of: string
  workspace_id: number
  reflection_id: number
  generated_by: 'ai' | 'heuristic'
  rules_implemented: number
  measure: MeasureStats
}

/** Run a full reflection for one workspace. */
export async function runReflectionForWorkspace(
  db: Database.Database,
  opts: { weekOf?: string; workspaceId: number; actor?: string },
): Promise<ReflectionResult> {
  const weekOf = opts.weekOf || weekStart(Date.now())
  const workspaceId = opts.workspaceId
  const actor = opts.actor || 'scheduler'

  // 1. MEASURE running experiments for the week being reflected.
  const measure = measureExperiments(db, weekOf, workspaceId)

  // 2. COLLECT the week.
  const data = collectWeekData(db, weekOf, workspaceId)

  // 3. REFLECT.
  const { parsed, generatedBy, model, inputTokens, outputTokens } = await callClaudeForReflection(data, workspaceId)

  // 4. Persist the reflection row.
  const now = Math.floor(Date.now() / 1000)
  const res = db.prepare(
    `INSERT INTO atlas_weekly_reflections
       (week_of, generated_by, model, reflection, insights, handoffs, bottlenecks, data_snapshot,
        improvements_recommended, improvements_implemented, input_tokens, output_tokens, status, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?)
     ON CONFLICT(week_of, workspace_id) DO UPDATE SET
       generated_by=excluded.generated_by, model=excluded.model, reflection=excluded.reflection,
       insights=excluded.insights, handoffs=excluded.handoffs, bottlenecks=excluded.bottlenecks,
       data_snapshot=excluded.data_snapshot, improvements_recommended=excluded.improvements_recommended,
       input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, status='generated', updated_at=excluded.updated_at`,
  ).run(
    weekOf, generatedBy, model, parsed.reflection,
    JSON.stringify(parsed.insights), JSON.stringify(parsed.handoffs), JSON.stringify(parsed.bottlenecks),
    JSON.stringify(data), JSON.stringify(parsed.recommended_rules), JSON.stringify([]),
    inputTokens, outputTokens, now, now, workspaceId,
  )

  const reflectionRow = db.prepare(
    `SELECT id FROM atlas_weekly_reflections WHERE week_of = ? AND workspace_id = ?`,
  ).get(weekOf, workspaceId) as { id: number }
  const reflectionId = reflectionRow.id

  // 5. LEARN — upsert recommended rules + open experiments.
  const implemented = upsertRecommendedRules(db, parsed.recommended_rules, reflectionId, weekOf, workspaceId)
  db.prepare(`UPDATE atlas_weekly_reflections SET improvements_implemented = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(implemented), now, reflectionId)

  db_helpers.logActivity(
    'atlas_reflection', 'agent', 0, actor,
    `Atlas weekly reflection (${weekOf}): ${generatedBy}, ${implemented.length} rule(s), ${measure.armed} armed, ${measure.retired} retired`,
    { weekOf, generatedBy, implemented: implemented.length, measure }, workspaceId,
  )

  return { week_of: weekOf, workspace_id: workspaceId, reflection_id: reflectionId, generated_by: generatedBy, rules_implemented: implemented.length, measure }
}

/** Scheduler entrypoint — reflect across every workspace with agents. Never throws. */
export async function runWeeklyAtlasReflection(): Promise<{ ok: boolean; message: string }> {
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    const weekOf = weekStart(Date.now())
    const results: ReflectionResult[] = []
    for (const ws of workspacesWithAgents(db)) {
      try {
        results.push(await runReflectionForWorkspace(db, { weekOf, workspaceId: ws, actor: 'scheduler' }))
      } catch (err) {
        logger.error({ err, workspaceId: ws }, 'Atlas reflection failed for workspace')
      }
    }
    if (results.length === 0) return { ok: false, message: 'Atlas reflection produced no results' }
    const rules = results.reduce((a, r) => a + r.rules_implemented, 0)
    const armed = results.reduce((a, r) => a + r.measure.armed, 0)
    const retired = results.reduce((a, r) => a + r.measure.retired, 0)
    const ai = results.filter((r) => r.generated_by === 'ai').length
    return {
      ok: true,
      message: `Reflected ${weekOf} for ${results.length} workspace(s) (${ai} via AI): ${rules} rule(s) learned, ${armed} armed, ${retired} retired`,
    }
  } catch (err: any) {
    logger.error({ err }, 'runWeeklyAtlasReflection failed')
    return { ok: false, message: `Atlas reflection failed: ${err.message}` }
  }
}

// ---- Dashboard aggregation ----

export interface AtlasDashboard {
  reflections: any[]
  rules: any[]
  experiments: any[]
  summary: {
    total_reflections: number
    last_reflection_week: string | null
    armed_rules: number
    shadow_rules: number
    retired_rules: number
    experiments_running: number
    experiments_improved: number
  }
}

export function getAtlasDashboard(db: Database.Database, workspaceId = 1): AtlasDashboard {
  const reflections = db
    .prepare(`SELECT * FROM atlas_weekly_reflections WHERE workspace_id = ? ORDER BY week_of DESC LIMIT 20`)
    .all(workspaceId) as any[]
  for (const r of reflections) {
    r.insights = safeJson(r.insights) || []
    r.handoffs = safeJson(r.handoffs) || { worked: [], broke: [] }
    r.bottlenecks = safeJson(r.bottlenecks) || []
    r.improvements_recommended = safeJson(r.improvements_recommended) || []
    r.improvements_implemented = safeJson(r.improvements_implemented) || []
    delete r.data_snapshot // keep the payload lean; full snapshot stays in DB
  }

  const rules = db
    .prepare(
      `SELECT * FROM atlas_coordination_rules WHERE workspace_id = ?
        ORDER BY (status='armed') DESC, (status='shadow') DESC, confidence DESC, applied_count DESC`,
    )
    .all(workspaceId) as any[]

  const experiments = db
    .prepare(
      `SELECT e.*, r.title AS rule_title, r.status AS rule_status
         FROM atlas_experiments e JOIN atlas_coordination_rules r ON r.id = e.rule_id
        WHERE e.workspace_id = ? ORDER BY e.week_of DESC, e.updated_at DESC LIMIT 100`,
    )
    .all(workspaceId) as any[]

  const summary = {
    total_reflections: reflections.length,
    last_reflection_week: reflections[0]?.week_of ?? null,
    armed_rules: rules.filter((r) => r.status === 'armed').length,
    shadow_rules: rules.filter((r) => r.status === 'shadow').length,
    retired_rules: rules.filter((r) => r.status === 'retired').length,
    experiments_running: experiments.filter((e) => e.status === 'running').length,
    experiments_improved: experiments.filter((e) => e.verdict === 'improved').length,
  }

  return { reflections, rules, experiments, summary }
}
