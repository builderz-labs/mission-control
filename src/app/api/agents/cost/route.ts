import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

// Provides a lightweight /api/agents/cost endpoint for the UI to display per-agent spend.
// Aggregates token_usage rows, summarizes tokens, and applies existing price tiers to estimate cost.
const MODEL_PRICING: Record<string, number> = {
  'anthropic/claude-3-5-haiku-latest': 0.25,
  'claude-3-5-haiku': 0.25,
  'anthropic/claude-sonnet-4-20250514': 3.0,
  'claude-sonnet-4': 3.0,
  'anthropic/claude-opus-4-5': 15.0,
  'claude-opus-4-5': 15.0,
  'groq/llama-3.1-8b-instant': 0.05,
  'groq/llama-3.3-70b-versatile': 0.59,
  'moonshot/kimi-k2.5': 1.0,
  'minimax/minimax-m2.1': 0.3,
  'ollama/deepseek-r1:14b': 0.0,
  'ollama/qwen2.5-coder:7b': 0.0,
  'ollama/qwen2.5-coder:14b': 0.0,
}

function getModelCost(modelName: string): number {
  if (MODEL_PRICING[modelName] !== undefined) return MODEL_PRICING[modelName]
  for (const [model, cost] of Object.entries(MODEL_PRICING)) {
    const key = model.split('/').pop() || model
    if (modelName.includes(key)) return cost
  }
  return 1.0
}

type AgentCostRow = {
  agent_name: string
  model: string
  total_tokens: number
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const rows = db
      .prepare(`
        SELECT
          CASE
            WHEN instr(session_id, ':') > 0 THEN substr(session_id, 1, instr(session_id, ':') - 1)
            ELSE session_id
          END AS agent_name,
          COALESCE(model, 'unknown') AS model,
          SUM(input_tokens + output_tokens) AS total_tokens
        FROM token_usage
        GROUP BY agent_name, model
      `)
      .all() as AgentCostRow[]

    const agents: Record<
      string,
      {
        totalTokens: number
        totalCost: number
        models: Record<string, { tokens: number; cost: number }>
      }
    > = {}

    for (const row of rows) {
      const agent = row.agent_name?.trim() || 'unknown'
      const model = row.model || 'unknown'
      const tokens = Number(row.total_tokens ?? 0)
      const costPer1k = getModelCost(model)
      const cost = (tokens / 1000) * costPer1k

      if (!agents[agent]) {
        agents[agent] = { totalTokens: 0, totalCost: 0, models: {} }
      }

      const bucket = agents[agent]
      bucket.totalTokens += tokens
      bucket.totalCost += cost
      if (!bucket.models[model]) {
        bucket.models[model] = { tokens: 0, cost: 0 }
      }
      bucket.models[model].tokens += tokens
      bucket.models[model].cost += cost
    }

    const agentCosts = Object.entries(agents)
      .map(([name, data]) => ({
        name,
        totalTokens: data.totalTokens,
        totalCost: data.totalCost,
        models: data.models,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)

    const totalTokens = agentCosts.reduce((sum, agent) => sum + agent.totalTokens, 0)
    const totalCost = agentCosts.reduce((sum, agent) => sum + agent.totalCost, 0)

    return NextResponse.json({
      fetchedAt: Date.now(),
      totalTokens,
      totalCost,
      agents: agentCosts,
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to load agent costs')
    return NextResponse.json({ error: 'Failed to load agent costs' }, { status: 500 })
  }
}
