import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { calculateTokenCost } from '@/lib/token-pricing'
import { getProviderSubscriptionFlags } from '@/lib/provider-subscriptions'
import { logger } from '@/lib/logger'

interface AgentBreakdownRow {
  agent_key: string
  total_input_tokens: number
  total_output_tokens: number
  session_count: number
  request_count: number
  last_active: number
  models_json: string
}

interface ModelBreakdown {
  model: string
  input_tokens: number
  output_tokens: number
  request_count: number
  cost: number
}

interface AgentBreakdown {
  agent: string
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost: number
  session_count: number
  request_count: number
  last_active: string
  models: ModelBreakdown[]
}

/**
 * GET /api/tokens/by-agent - Per-agent cost breakdown from token_usage table
 * Query params:
 *   days=N  - Time window in days (default 30)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(365, Number(searchParams.get('days') || 30)))
    const workspaceId = auth.user.workspace_id ?? 1

    const db = getDatabase()
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    const providerSubscriptions = getProviderSubscriptionFlags()

    // Query per-agent totals with per-model breakdown embedded as JSON
    const rows = db.prepare(`
      SELECT
        CASE
          WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1)
          ELSE session_id
        END AS agent_key,
        SUM(input_tokens)  AS total_input_tokens,
        SUM(output_tokens) AS total_output_tokens,
        COUNT(DISTINCT session_id) AS session_count,
        COUNT(*)           AS request_count,
        MAX(created_at)    AS last_active,
        GROUP_CONCAT(DISTINCT model) AS models_json
      FROM token_usage
      WHERE workspace_id = ?
        AND created_at >= ?
      GROUP BY agent_key
      ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(workspaceId, cutoff) as AgentBreakdownRow[]

    // For accurate per-model cost we need a second pass grouping by agent+model
    const modelRows = db.prepare(`
      SELECT
        CASE
          WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1)
          ELSE session_id
        END AS agent_key,
        model,
        SUM(input_tokens)  AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        COUNT(*)           AS request_count
      FROM token_usage
      WHERE workspace_id = ?
        AND created_at >= ?
      GROUP BY agent_key, model
      ORDER BY agent_key, (SUM(input_tokens) + SUM(output_tokens)) DESC
    `).all(workspaceId, cutoff) as Array<{
      agent_key: string
      model: string
      input_tokens: number
      output_tokens: number
      request_count: number
    }>

    // Build model map keyed by agent name
    const modelsByAgent = new Map<string, ModelBreakdown[]>()
    for (const row of modelRows) {
      const cost = calculateTokenCost(row.model, row.input_tokens, row.output_tokens, { providerSubscriptions })
      const list = modelsByAgent.get(row.agent_key) || []
      list.push({
        model: row.model,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        request_count: row.request_count,
        cost,
      })
      modelsByAgent.set(row.agent_key, list)
    }

    // Assemble final response
    const agents: AgentBreakdown[] = rows.map((row) => {
      const models = modelsByAgent.get(row.agent_key) || []
      const totalCost = models.reduce((sum, m) => sum + m.cost, 0)
      return {
        agent: row.agent_key,
        total_input_tokens: row.total_input_tokens,
        total_output_tokens: row.total_output_tokens,
        total_tokens: row.total_input_tokens + row.total_output_tokens,
        total_cost: totalCost,
        session_count: row.session_count,
        request_count: row.request_count,
        last_active: new Date(row.last_active * 1000).toISOString(),
        models,
      }
    })

    const totalCost = agents.reduce((sum, a) => sum + a.total_cost, 0)
    const totalTokens = agents.reduce((sum, a) => sum + a.total_tokens, 0)

    return NextResponse.json({
      agents,
      summary: {
        total_cost: totalCost,
        total_tokens: totalTokens,
        agent_count: agents.length,
        days,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tokens/by-agent error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
