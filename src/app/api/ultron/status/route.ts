import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { ALL_ULTRON_AGENTS, getAgentsByTier } from '@/lib/ultron-agents'
import { logger } from '@/lib/logger'
import { readLimiter } from '@/lib/rate-limit'

/**
 * GET /api/ultron/status
 * Returns a comprehensive overview of the Ultron system:
 * - Agent hierarchy status (seeded, active, idle)
 * - Autonomous engine health (self-healing, self-learning, self-improving)
 * - System vitals
 */
export async function GET(request: NextRequest) {
  const limited = readLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  try {
    // --- Agent Hierarchy ---
    const agentNames = ALL_ULTRON_AGENTS.map(a => a.name)
    const placeholders = agentNames.map(() => '?').join(',')
    const seededAgents = db.prepare(
      `SELECT name, status FROM agents WHERE name IN (${placeholders}) AND workspace_id = ?`
    ).all(...agentNames, workspaceId) as Array<{ name: string; status: string }>

    const seededSet = new Set(seededAgents.map(a => a.name))
    const statusCounts = { idle: 0, active: 0, busy: 0, error: 0, other: 0 }
    for (const a of seededAgents) {
      const key = a.status as keyof typeof statusCounts
      if (key in statusCounts) statusCounts[key]++
      else statusCounts.other++
    }

    const hierarchy = {
      expected: ALL_ULTRON_AGENTS.length,
      seeded: seededAgents.length,
      missing: ALL_ULTRON_AGENTS.length - seededAgents.length,
      missingNames: agentNames.filter(n => !seededSet.has(n)),
      tiers: {
        commander: getAgentsByTier(1).length,
        cSuite: getAgentsByTier(2).length,
        specialists: getAgentsByTier(3).length,
      },
      statusCounts,
    }

    // --- Self-Healing ---
    let healing = { circuitBreakers: 0, openCircuits: 0, recentRecoveries: 0, healthChecks: 0 }
    try {
      const cbCount = db.prepare('SELECT COUNT(*) as c FROM circuit_breakers WHERE workspace_id = ?').get(workspaceId) as { c: number } | undefined
      const openCb = db.prepare("SELECT COUNT(*) as c FROM circuit_breakers WHERE state = 'open' AND workspace_id = ?").get(workspaceId) as { c: number } | undefined
      const recentRec = db.prepare('SELECT COUNT(*) as c FROM recovery_logs WHERE created_at > ? AND workspace_id = ?').get(Math.floor(Date.now() / 1000) - 86400, workspaceId) as { c: number } | undefined
      const hcCount = db.prepare('SELECT COUNT(*) as c FROM health_checks WHERE created_at > ? AND workspace_id = ?').get(Math.floor(Date.now() / 1000) - 3600, workspaceId) as { c: number } | undefined
      healing = {
        circuitBreakers: cbCount?.c ?? 0,
        openCircuits: openCb?.c ?? 0,
        recentRecoveries: recentRec?.c ?? 0,
        healthChecks: hcCount?.c ?? 0,
      }
    } catch {
      // Tables may not exist yet if migrations haven't run
    }

    // --- Self-Learning ---
    let learning = { totalPatterns: 0, avgConfidence: 0, totalTraces: 0, recentFeedback: 0 }
    try {
      const patCount = db.prepare('SELECT COUNT(*) as c FROM learned_patterns WHERE workspace_id = ?').get(workspaceId) as { c: number } | undefined
      const avgConf = db.prepare('SELECT AVG(confidence) as avg FROM learned_patterns WHERE workspace_id = ?').get(workspaceId) as { avg: number | null } | undefined
      const traceCount = db.prepare('SELECT COUNT(*) as c FROM execution_traces WHERE workspace_id = ?').get(workspaceId) as { c: number } | undefined
      const fbCount = db.prepare('SELECT COUNT(*) as c FROM feedback_entries WHERE created_at > ? AND workspace_id = ?').get(Math.floor(Date.now() / 1000) - 604800, workspaceId) as { c: number } | undefined
      learning = {
        totalPatterns: patCount?.c ?? 0,
        avgConfidence: Math.round((avgConf?.avg ?? 0) * 100) / 100,
        totalTraces: traceCount?.c ?? 0,
        recentFeedback: fbCount?.c ?? 0,
      }
    } catch {
      // Tables may not exist yet
    }

    // --- Self-Improving ---
    let improving = { regressions: 0, pendingSuggestions: 0, costRecords: 0, avgQuality: 0 }
    try {
      const regCount = db.prepare('SELECT COUNT(*) as c FROM performance_baselines WHERE regression_detected = 1 AND workspace_id = ?').get(workspaceId) as { c: number } | undefined
      const sugCount = db.prepare("SELECT COUNT(*) as c FROM improvement_suggestions WHERE status = 'pending' AND workspace_id = ?").get(workspaceId) as { c: number } | undefined
      const costCount = db.prepare('SELECT COUNT(*) as c FROM cost_tracking WHERE workspace_id = ?').get(workspaceId) as { c: number } | undefined
      const avgQ = db.prepare('SELECT AVG(quality_score) as avg FROM cost_tracking WHERE quality_score IS NOT NULL AND workspace_id = ?').get(workspaceId) as { avg: number | null } | undefined
      improving = {
        regressions: regCount?.c ?? 0,
        pendingSuggestions: sugCount?.c ?? 0,
        costRecords: costCount?.c ?? 0,
        avgQuality: Math.round((avgQ?.avg ?? 0) * 100) / 100,
      }
    } catch {
      // Tables may not exist yet
    }

    return NextResponse.json({
      system: 'Ultron Mission Control',
      version: '1.0.0',
      coordinator: 'ultron',
      timestamp: new Date().toISOString(),
      hierarchy,
      engines: {
        healing,
        learning,
        improving,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/ultron/status failed')
    return NextResponse.json({ error: 'Failed to fetch Ultron status' }, { status: 500 })
  }
}
