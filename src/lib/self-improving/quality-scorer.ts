// Quality-scoring sub-module.
// Reads quality_score values stored alongside cost records and surfaces
// per-agent summaries. Also owns the improvement-suggestion lifecycle:
// creating, listing, updating status, and auto-generating suggestions
// from detected regressions, high-cost agents, and low-quality patterns.

import { getDatabase } from '../db'
import { getRegressions } from './profiler'
import { getCostByAgent } from './cost-tracker'
import type {
  ImprovementSuggestion,
  QualitySummary,
  SuggestionCategory,
  SuggestionSeverity,
  SuggestionStatus,
} from './types'

// Cost outlier threshold: flag agents whose avg cost exceeds the workspace
// mean by more than 3x — chosen to avoid false positives on rare task types.
const COST_COMPARISON_THRESHOLD = 3.0

// Require at least 5 samples before drawing any conclusions — single-sample
// anomalies produce too many noisy suggestions.
const MIN_SAMPLES_FOR_ANALYSIS = 5

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureQualityScorerTables(): void {
  const db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS improvement_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT CHECK(category IN ('performance', 'cost', 'quality', 'architecture')),
      severity TEXT CHECK(severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected', 'implemented')) DEFAULT 'pending',
      workspace_id INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      resolved_at INTEGER
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_status ON improvement_suggestions(status, workspace_id)`)
}

// ---------------------------------------------------------------------------
// Quality queries
// ---------------------------------------------------------------------------

export function getQualityScores(workspaceId: number): ReadonlyArray<QualitySummary> {
  const db = getDatabase()
  return db.prepare(`
    SELECT agent_id,
           AVG(quality_score) as avg_quality,
           MIN(quality_score) as min_quality,
           MAX(quality_score) as max_quality,
           COUNT(*) as record_count
    FROM cost_tracking
    WHERE workspace_id = ? AND quality_score IS NOT NULL
    GROUP BY agent_id
    ORDER BY avg_quality DESC
  `).all(workspaceId) as QualitySummary[]
}

// ---------------------------------------------------------------------------
// Suggestion CRUD
// ---------------------------------------------------------------------------

export function createSuggestion(
  category: SuggestionCategory,
  severity: SuggestionSeverity,
  title: string,
  description: string,
  evidence: string | null,
  workspaceId: number,
): ImprovementSuggestion {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO improvement_suggestions (category, severity, title, description, evidence, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(category, severity, title, description, evidence, workspaceId)

  return {
    id: Number(result.lastInsertRowid),
    category,
    severity,
    title,
    description,
    evidence,
    status: 'pending',
    workspace_id: workspaceId,
    created_at: Math.floor(Date.now() / 1000),
    resolved_at: null,
  }
}

export function updateSuggestionStatus(
  id: number,
  status: SuggestionStatus,
  workspaceId: number,
): ImprovementSuggestion | null {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const resolvedAt = (status === 'implemented' || status === 'rejected') ? now : null

  db.prepare(`
    UPDATE improvement_suggestions
    SET status = ?, resolved_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(status, resolvedAt, id, workspaceId)

  return db.prepare(
    'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE id = ? AND workspace_id = ?'
  ).get(id, workspaceId) as ImprovementSuggestion | null
}

export function getSuggestions(
  workspaceId: number,
  status?: SuggestionStatus,
): ReadonlyArray<ImprovementSuggestion> {
  const db = getDatabase()

  if (status) {
    return db.prepare(
      'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(workspaceId, status) as ImprovementSuggestion[]
  }

  return db.prepare(
    'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE workspace_id = ? ORDER BY created_at DESC'
  ).all(workspaceId) as ImprovementSuggestion[]
}

// ---------------------------------------------------------------------------
// Auto-generation
// ---------------------------------------------------------------------------

export function generateSuggestions(workspaceId: number): ReadonlyArray<ImprovementSuggestion> {
  return [
    ...generateRegressionSuggestions(workspaceId),
    ...generateCostSuggestions(workspaceId),
    ...generateQualitySuggestions(workspaceId),
  ]
}

function generateRegressionSuggestions(workspaceId: number): ImprovementSuggestion[] {
  const regressions = getRegressions(workspaceId)
  const created: ImprovementSuggestion[] = []

  for (const reg of regressions) {
    const pctSlower = reg.current_avg_ms && reg.baseline_ms
      ? Math.round(((reg.current_avg_ms - reg.baseline_ms) / reg.baseline_ms) * 100)
      : 0

    const suggestion = createSuggestion(
      'performance',
      pctSlower > 50 ? 'critical' : 'warning',
      `Performance regression: ${reg.operation_name}`,
      `Operation "${reg.operation_name}" is ${pctSlower}% slower than baseline (${Math.round(reg.baseline_ms)}ms -> ${Math.round(reg.current_avg_ms ?? 0)}ms).`,
      JSON.stringify({ baseline_ms: reg.baseline_ms, current_avg_ms: reg.current_avg_ms, sample_count: reg.sample_count }),
      workspaceId,
    )
    created.push(suggestion)
  }

  return created
}

function generateCostSuggestions(workspaceId: number): ImprovementSuggestion[] {
  const agentCosts = getCostByAgent(workspaceId)
  const created: ImprovementSuggestion[] = []

  if (agentCosts.length < 2) return created

  const avgCostAcrossAgents = agentCosts.reduce((sum, a) => sum + a.avg_cost, 0) / agentCosts.length

  for (const agent of agentCosts) {
    if (
      agent.avg_cost > avgCostAcrossAgents * COST_COMPARISON_THRESHOLD
      && agent.record_count >= MIN_SAMPLES_FOR_ANALYSIS
    ) {
      const suggestion = createSuggestion(
        'cost',
        'warning',
        `High cost agent: ${agent.agent_id}`,
        `Agent "${agent.agent_id}" averages $${agent.avg_cost.toFixed(4)} per task, ${(agent.avg_cost / avgCostAcrossAgents).toFixed(1)}x the average across all agents.`,
        JSON.stringify({ avg_cost: agent.avg_cost, avg_across_agents: avgCostAcrossAgents, total_cost: agent.total_cost }),
        workspaceId,
      )
      created.push(suggestion)
    }
  }

  return created
}

function generateQualitySuggestions(workspaceId: number): ImprovementSuggestion[] {
  const quality = getQualityScores(workspaceId)
  const created: ImprovementSuggestion[] = []

  for (const q of quality) {
    if (q.avg_quality < 0.5 && q.record_count >= MIN_SAMPLES_FOR_ANALYSIS) {
      const suggestion = createSuggestion(
        'quality',
        q.avg_quality < 0.3 ? 'critical' : 'warning',
        `Low quality scores: ${q.agent_id}`,
        `Agent "${q.agent_id}" has an average quality score of ${q.avg_quality.toFixed(2)} across ${q.record_count} tasks.`,
        JSON.stringify({ avg_quality: q.avg_quality, min_quality: q.min_quality, max_quality: q.max_quality }),
        workspaceId,
      )
      created.push(suggestion)
    }
  }

  return created
}
