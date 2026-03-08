import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getCrmStats } from '@/lib/crm'

/**
 * GET /api/boot-context?agent=jarvis-dev
 *
 * Returns aggregated context for an agent's session boot.
 * Auth: Bearer token via MC_API_KEY env var.
 */

function authenticateApiKey(request: NextRequest): boolean {
  const apiKey = process.env.MC_API_KEY
  if (!apiKey || apiKey.trim().length === 0) {
    // No API key configured — reject all requests
    return false
  }
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '')
  try {
    const tokenBuf = Buffer.from(token)
    const keyBuf = Buffer.from(apiKey)
    if (tokenBuf.length !== keyBuf.length) return false
    return timingSafeEqual(tokenBuf, keyBuf)
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (!authenticateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const agentName = searchParams.get('agent')
    const workspaceId = 1

    // Agent info
    let agent: any = null
    try {
      agent = db.prepare(`
        SELECT id, name, role, status, config, last_seen
        FROM agents WHERE workspace_id = ? ${agentName ? 'AND name = ?' : ''}
        LIMIT 1
      `).get(...(agentName ? [workspaceId, agentName] : [workspaceId]))
      if (agent?.config) {
        try { agent.config = JSON.parse(agent.config) } catch { agent.config = {} }
      }
    } catch { /* agents table may not exist */ }

    // Channel bindings (from Phase 2)
    let channels: any[] = []
    try {
      const channelQuery = agentName
        ? `SELECT platform, channel_kind, channel_id, channel_name, is_active FROM channel_bindings WHERE workspace_id = ? AND agent_name = ? AND is_active = 1`
        : `SELECT platform, channel_kind, channel_id, channel_name, is_active FROM channel_bindings WHERE workspace_id = ? AND is_active = 1`
      channels = db.prepare(channelQuery).all(...(agentName ? [workspaceId, agentName] : [workspaceId]))
    } catch { /* table may not exist yet */ }

    // Active strategic decisions (from Phase 1)
    let activeDecisions: any[] = []
    try {
      activeDecisions = db.prepare(`
        SELECT id, decision, rationale, category, confidence, scope, tags, revisit_by, owner
        FROM decision_records
        WHERE workspace_id = ? AND status = 'active' AND (scope = 'strategic' OR scope = 'operational')
        ORDER BY created_at DESC
        LIMIT 20
      `).all(workspaceId)
      activeDecisions = activeDecisions.map(d => ({
        ...d,
        tags: d.tags ? JSON.parse(d.tags) : [],
      }))
    } catch { /* table may not exist yet */ }

    // Active tasks for this agent
    let activeTasks: any[] = []
    try {
      let taskQuery = `
        SELECT t.id, t.title, t.status, t.priority, t.priority_tier, t.due_date,
               t.context_note, t.definition_of_done, t.sla_status,
               t.blocked_type, t.blocked_reason,
               p.name as project_name, p.slug as project_slug
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
        WHERE t.workspace_id = ? AND t.status NOT IN ('done', 'cancelled')
      `
      const taskParams: any[] = [workspaceId]
      if (agentName) {
        taskQuery += ' AND t.assigned_to = ?'
        taskParams.push(agentName)
      }
      taskQuery += ` ORDER BY CASE t.priority_tier WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, t.created_at DESC LIMIT 20`
      activeTasks = db.prepare(taskQuery).all(...taskParams)
    } catch { /* tasks table columns may differ */ }

    // Recent memory (from Phase 3)
    let recentMemory: any[] = []
    try {
      const memQuery = agentName
        ? `SELECT id, type, title, summary, agent, date_ref, created_at FROM memory_records WHERE workspace_id = ? AND is_archived = 0 AND (agent = ? OR agent IS NULL) ORDER BY created_at DESC LIMIT 10`
        : `SELECT id, type, title, summary, agent, date_ref, created_at FROM memory_records WHERE workspace_id = ? AND is_archived = 0 ORDER BY created_at DESC LIMIT 10`
      recentMemory = db.prepare(memQuery).all(...(agentName ? [workspaceId, agentName] : [workspaceId]))
    } catch { /* table may not exist yet */ }

    // Team status (other agents)
    let team: any[] = []
    try {
      team = db.prepare(`
        SELECT name, status, role, last_seen
        FROM agents WHERE workspace_id = ?
        ORDER BY name ASC
      `).all(workspaceId)
    } catch { /* agents table may not exist */ }

    // CRM summary (from Phase 4)
    let crmSummary = { hot_contacts: 0, warm_contacts: 0, total_contacts: 0 }
    try {
      const stats = getCrmStats()
      if (stats) {
        crmSummary = {
          hot_contacts: stats.by_warmth?.hot || 0,
          warm_contacts: stats.by_warmth?.warm || 0,
          total_contacts: stats.total_contacts || 0,
        }
      }
    } catch { /* CRM module may not exist yet */ }

    return NextResponse.json({
      agent: agent || null,
      channels,
      active_decisions: activeDecisions,
      active_tasks: activeTasks,
      recent_memory: recentMemory,
      team,
      crm_summary: crmSummary,
      generated_at: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/boot-context error')
    return NextResponse.json({ error: 'Failed to generate boot context' }, { status: 500 })
  }
}
