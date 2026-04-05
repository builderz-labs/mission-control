export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { readLimiter } from '@/lib/rate-limit'
import { fetchAllAgentMetrics, computeCognitiveLoad } from '@/lib/cognitive-load'
import { selfHealingEngine } from '@/lib/self-healing'
import { ALL_ULTRON_AGENTS } from '@/lib/ultron-agents'

// ── Shared types ─────────────────────────────────────────────────────────────

export interface CriticalAgent {
  readonly id: string
  readonly name: string
  readonly department: string
  readonly color: string
  readonly score: number
  readonly level: string
}

export interface ActiveAlert {
  readonly id: number
  readonly name: string
  readonly trigger_count: number
  readonly last_triggered_at: number | null
}

export interface RecentError {
  readonly id: number
  readonly type: string
  readonly title: string
  readonly agent_name: string | null
  readonly created_at: number
}

export interface ServiceStatus {
  readonly serviceName: string
  readonly status: string
}

export interface WarRoomStats {
  readonly totalAgents: number
  readonly criticalCount: number
  readonly warningCount: number
  readonly healthyCount: number
  readonly activeAlertCount: number
  readonly errorCount24h: number
}

export interface WarRoomSnapshot {
  readonly timestamp: number
  readonly systemHealth: 'healthy' | 'degraded' | 'critical'
  readonly healthScore: number
  readonly services: ServiceStatus[]
  readonly criticalAgents: CriticalAgent[]
  readonly warningAgents: CriticalAgent[]
  readonly activeAlerts: ActiveAlert[]
  readonly recentErrors: RecentError[]
  readonly stats: WarRoomStats
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface AlertRuleRow {
  id: number
  name: string
  enabled: number
  condition_field: string
  condition_operator: string
  condition_value: string
  trigger_count: number
  last_triggered_at: number | null
}

interface ActivityRow {
  id: number
  type: string
  description: string
  actor: string | null
  created_at: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map agentId/agentName → definition for department + color lookup */
const agentDefMap = new Map(
  ALL_ULTRON_AGENTS.map(a => [a.name.toLowerCase(), a])
)

/** Compute an 0-100 health score from the self-healing summary. */
function computeHealthScore(services: ReadonlyArray<{ status: string }>): number {
  if (services.length === 0) return 100
  const healthyCount = services.filter(s => s.status === 'healthy').length
  return Math.round((healthyCount / services.length) * 100)
}

function systemHealthLevel(score: number): 'healthy' | 'degraded' | 'critical' {
  if (score < 50) return 'critical'
  if (score < 80) return 'degraded'
  return 'healthy'
}

/** Query active alert rules that have fired at least once. */
function fetchActiveAlerts(db: any, workspaceId: number): ActiveAlert[] {
  const rows = db.prepare(
    `SELECT id, name, enabled, condition_field, condition_operator, condition_value,
            trigger_count, last_triggered_at
     FROM alert_rules
     WHERE workspace_id = ? AND enabled = 1 AND trigger_count > 0
     ORDER BY trigger_count DESC`
  ).all(workspaceId) as AlertRuleRow[]

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    trigger_count: r.trigger_count,
    last_triggered_at: r.last_triggered_at,
  }))
}

/** Query last 20 error-type or critical activities. */
function fetchRecentErrors(db: any, workspaceId: number): RecentError[] {
  // activities.type contains strings like 'error', 'task_error', 'agent_error'
  const rows = db.prepare(
    `SELECT id, type, description, actor, created_at
     FROM activities
     WHERE workspace_id = ?
       AND (type LIKE '%error%' OR type LIKE '%fail%' OR type LIKE '%critical%')
     ORDER BY created_at DESC
     LIMIT 20`
  ).all(workspaceId) as ActivityRow[]

  return rows.map(r => ({
    id: r.id,
    type: r.type,
    title: r.description,
    agent_name: r.actor ?? null,
    created_at: r.created_at,
  }))
}

/** Count errors from the last 24 hours. */
function countErrors24h(db: any, workspaceId: number): number {
  const since = Math.floor(Date.now() / 1000) - 86400
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM activities
     WHERE workspace_id = ? AND created_at >= ?
       AND (type LIKE '%error%' OR type LIKE '%fail%' OR type LIKE '%critical%')`
  ).get(workspaceId, since) as { cnt: number }
  return row?.cnt ?? 0
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/war-room
 * Crisis command center snapshot: cognitive load, system health, alerts, errors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // 1. Cognitive load per agent
    const rawMetrics = fetchAllAgentMetrics(db, workspaceId)
    const agentLoads = rawMetrics.map(m => ({
      agentId: String(m.agentId),
      agentName: m.agentName,
      load: computeCognitiveLoad({
        activeTasks: m.activeTasks,
        pendingTasks: m.pendingTasks,
        errorCount: m.errorCount,
        totalActivities: m.totalActivities,
        recentTokens: m.recentTokens,
        lastSeen: m.lastSeen,
      }),
    }))

    // 2. System health from self-healing engine
    const healthSummary = selfHealingEngine.getHealthSummary()
    const healthScore = computeHealthScore(healthSummary.services)

    // 3. Build critical/warning agent lists with definition metadata
    const criticalAgents: CriticalAgent[] = []
    const warningAgents: CriticalAgent[] = []

    for (const entry of agentLoads) {
      if (entry.load.level !== 'critical' && entry.load.level !== 'warning') continue
      const def = agentDefMap.get(entry.agentName.toLowerCase())
      const agent: CriticalAgent = {
        id: entry.agentId,
        name: entry.agentName,
        department: def?.department ?? 'Unknown',
        color: def?.color ?? '#9CA3AF',
        score: entry.load.score,
        level: entry.load.level,
      }
      if (entry.load.level === 'critical') criticalAgents.push(agent)
      else warningAgents.push(agent)
    }

    // Sort by score descending
    criticalAgents.sort((a, b) => b.score - a.score)
    warningAgents.sort((a, b) => b.score - a.score)

    // 4. Active alerts + recent errors
    const activeAlerts = fetchActiveAlerts(db, workspaceId)
    const recentErrors = fetchRecentErrors(db, workspaceId)
    const errorCount24h = countErrors24h(db, workspaceId)

    const services: ServiceStatus[] = healthSummary.services.map(s => ({
      serviceName: s.serviceName,
      status: s.status,
    }))

    const snapshot: WarRoomSnapshot = {
      timestamp: Date.now(),
      systemHealth: systemHealthLevel(healthScore),
      healthScore,
      services,
      criticalAgents,
      warningAgents,
      activeAlerts,
      recentErrors,
      stats: {
        totalAgents: agentLoads.length,
        criticalCount: criticalAgents.length,
        warningCount: warningAgents.length,
        healthyCount: agentLoads.filter(a => a.load.level === 'healthy').length,
        activeAlertCount: activeAlerts.length,
        errorCount24h,
      },
    }

    return NextResponse.json(snapshot)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/war-room failed')
    return NextResponse.json(
      { error: 'Failed to fetch war room data' },
      { status: 500 }
    )
  }
}
