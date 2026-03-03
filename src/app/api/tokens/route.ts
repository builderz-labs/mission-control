import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, access } from 'fs/promises'
import { dirname } from 'path'
import { config, ensureDirExists } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { getAllGatewaySessions } from '@/lib/sessions'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'

const DATA_PATH = config.tokensPath

interface TokenUsageRecord {
  id: string
  model: string
  sessionId: string
  agentName: string
  timestamp: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  operation: string
  duration?: number
}

interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

interface ExportData {
  usage: TokenUsageRecord[]
  summary: TokenStats
  models: Record<string, TokenStats>
  sessions: Record<string, TokenStats>
}

// Model pricing (cost per 1K tokens)
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

function extractAgentName(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (!trimmed) return 'unknown'
  const [agent] = trimmed.split(':')
  return agent?.trim() || 'unknown'
}

function getModelCost(modelName: string): number {
  if (MODEL_PRICING[modelName] !== undefined) return MODEL_PRICING[modelName]
  for (const [model, cost] of Object.entries(MODEL_PRICING)) {
    if (modelName.includes(model.split('/').pop() || '')) return cost
  }
  return 1.0
}

interface DbTokenUsageRow {
  id: number
  model: string
  session_id: string
  input_tokens: number
  output_tokens: number
  created_at: number
}

function loadTokenDataFromDb(): TokenUsageRecord[] {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT id, model, session_id, input_tokens, output_tokens, created_at
      FROM token_usage
      ORDER BY created_at DESC, id DESC
      LIMIT 10000
    `).all() as DbTokenUsageRow[]

    return rows.map((row) => {
      const totalTokens = row.input_tokens + row.output_tokens
      const costPer1k = getModelCost(row.model)
      return {
        id: `db-${row.id}`,
        model: row.model,
        sessionId: row.session_id,
        agentName: extractAgentName(row.session_id),
        timestamp: row.created_at * 1000,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens,
        cost: (totalTokens / 1000) * costPer1k,
        operation: 'heartbeat',
      }
    })
  } catch (error) {
    logger.warn({ err: error }, 'Failed to load token usage from database')
    return []
  }
}

function normalizeTokenRecord(record: Partial<TokenUsageRecord>): TokenUsageRecord | null {
  if (!record.model || !record.sessionId) return null
  const inputTokens = Number(record.inputTokens ?? 0)
  const outputTokens = Number(record.outputTokens ?? 0)
  const totalTokens = Number(record.totalTokens ?? inputTokens + outputTokens)
  const model = String(record.model)
  return {
    id: String(record.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`),
    model,
    sessionId: String(record.sessionId),
    agentName: String(record.agentName ?? extractAgentName(String(record.sessionId))),
    timestamp: Number(record.timestamp ?? Date.now()),
    inputTokens,
    outputTokens,
    totalTokens,
    cost: Number(record.cost ?? (totalTokens / 1000) * getModelCost(model)),
    operation: String(record.operation ?? 'chat_completion'),
    duration: record.duration,
  }
}

function dedupeTokenRecords(records: TokenUsageRecord[]): TokenUsageRecord[] {
  const seen = new Set<string>()
  const deduped: TokenUsageRecord[] = []

  for (const record of records) {
    const key = [
      record.sessionId,
      record.model,
      record.timestamp,
      record.inputTokens,
      record.outputTokens,
      record.totalTokens,
      record.operation,
      record.duration ?? '',
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(record)
  }

  return deduped
}

async function loadTokenDataFromFile(): Promise<TokenUsageRecord[]> {
  try {
    ensureDirExists(dirname(DATA_PATH))
    await access(DATA_PATH)
    const data = await readFile(DATA_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((record: Partial<TokenUsageRecord>) => normalizeTokenRecord(record))
      .filter((record): record is TokenUsageRecord => record !== null)
  } catch {
    return []
  }
}

/**
 * Load token data from persistent file, falling back to deriving from session stores.
 */
async function loadTokenData(): Promise<TokenUsageRecord[]> {
  const dbRecords = loadTokenDataFromDb()
  const fileRecords = await loadTokenDataFromFile()
  const combined = dedupeTokenRecords([...dbRecords, ...fileRecords]).sort((a, b) => b.timestamp - a.timestamp)
  if (combined.length > 0) {
    return combined
  }

  // Final fallback: derive from in-memory sessions
  return deriveFromSessions()
}

/**
 * Derive token usage records from OpenClaw session stores.
 * Each session has totalTokens, inputTokens, outputTokens, model, etc.
 */
function deriveFromSessions(): TokenUsageRecord[] {
  const sessions = getAllGatewaySessions(Infinity) // Get ALL sessions regardless of age
  const records: TokenUsageRecord[] = []

  for (const session of sessions) {
    if (!session.totalTokens && !session.model) continue // Skip empty sessions

    const totalTokens = session.totalTokens || 0
    const inputTokens = session.inputTokens || Math.round(totalTokens * 0.7)
    const outputTokens = session.outputTokens || totalTokens - inputTokens
    const costPer1k = getModelCost(session.model || '')
    const cost = (totalTokens / 1000) * costPer1k

    records.push({
      id: `session-${session.agent}-${session.key}`,
      model: session.model || 'unknown',
      sessionId: `${session.agent}:${session.chatType}`,
      agentName: session.agent || 'unknown',
      timestamp: session.updatedAt,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation: session.chatType || 'chat',
    })
  }

  records.sort((a, b) => b.timestamp - a.timestamp)
  return records
}

async function saveTokenData(data: TokenUsageRecord[]): Promise<void> {
  ensureDirExists(dirname(DATA_PATH))
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2))
}

function calculateStats(records: TokenUsageRecord[]): TokenStats {
  if (records.length === 0) {
    return {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
      avgTokensPerRequest: 0,
      avgCostPerRequest: 0,
    }
  }

  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0)
  const requestCount = records.length

  return {
    totalTokens,
    totalCost,
    requestCount,
    avgTokensPerRequest: Math.round(totalTokens / requestCount),
    avgCostPerRequest: totalCost / requestCount,
  }
}

function filterByTimeframe(records: TokenUsageRecord[], timeframe: string): TokenUsageRecord[] {
  const now = Date.now()
  let cutoffTime: number

  switch (timeframe) {
    case 'hour':
      cutoffTime = now - 60 * 60 * 1000
      break
    case 'day':
      cutoffTime = now - 24 * 60 * 60 * 1000
      break
    case 'week':
      cutoffTime = now - 7 * 24 * 60 * 60 * 1000
      break
    case 'month':
      cutoffTime = now - 30 * 24 * 60 * 60 * 1000
      break
    case 'all':
    default:
      return records
  }

  return records.filter(record => record.timestamp >= cutoffTime)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'
    const timeframe = searchParams.get('timeframe') || 'all'
    const format = searchParams.get('format') || 'json'

    const tokenData = await loadTokenData()
    const filteredData = filterByTimeframe(tokenData, timeframe)

    if (action === 'list') {
      return NextResponse.json({
        usage: filteredData.slice(0, 100),
        total: filteredData.length,
        timeframe,
      })
    }

    if (action === 'stats') {
      const overallStats = calculateStats(filteredData)

      const modelGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.model]) acc[record.model] = []
        acc[record.model].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const modelStats: Record<string, TokenStats> = {}
      for (const [model, records] of Object.entries(modelGroups)) {
        modelStats[model] = calculateStats(records)
      }

      const sessionGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.sessionId]) acc[record.sessionId] = []
        acc[record.sessionId].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const sessionStats: Record<string, TokenStats> = {}
      for (const [sessionId, records] of Object.entries(sessionGroups)) {
        sessionStats[sessionId] = calculateStats(records)
      }

      // Agent aggregation: extract agent name from sessionId (format: "agentName:chatType")
      const agentGroups = filteredData.reduce((acc, record) => {
        const agent = record.agentName || extractAgentName(record.sessionId)
        if (!acc[agent]) acc[agent] = []
        acc[agent].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const agentStats: Record<string, TokenStats> = {}
      for (const [agent, records] of Object.entries(agentGroups)) {
        agentStats[agent] = calculateStats(records)
      }

      return NextResponse.json({
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats,
        agents: agentStats,
        timeframe,
        recordCount: filteredData.length,
      })
    }

    if (action === 'agent-costs') {
      const agentGroups = filteredData.reduce((acc, record) => {
        const agent = record.agentName || extractAgentName(record.sessionId)
        if (!acc[agent]) acc[agent] = []
        acc[agent].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      const agents: Record<string, {
        stats: TokenStats
        models: Record<string, TokenStats>
        sessions: string[]
        timeline: Array<{ date: string; cost: number; tokens: number }>
      }> = {}

      for (const [agent, records] of Object.entries(agentGroups)) {
        const stats = calculateStats(records)

        // Per-agent model breakdown
        const modelGroups = records.reduce((acc, r) => {
          if (!acc[r.model]) acc[r.model] = []
          acc[r.model].push(r)
          return acc
        }, {} as Record<string, TokenUsageRecord[]>)
        const models: Record<string, TokenStats> = {}
        for (const [model, mrs] of Object.entries(modelGroups)) {
          models[model] = calculateStats(mrs)
        }

        // Unique sessions
        const sessions = [...new Set(records.map(r => r.sessionId))]

        // Daily timeline
        const dailyMap = records.reduce((acc, r) => {
          const date = new Date(r.timestamp).toISOString().split('T')[0]
          if (!acc[date]) acc[date] = { cost: 0, tokens: 0 }
          acc[date].cost += r.cost
          acc[date].tokens += r.totalTokens
          return acc
        }, {} as Record<string, { cost: number; tokens: number }>)

        const timeline = Object.entries(dailyMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({ date, ...data }))

        agents[agent] = { stats, models, sessions, timeline }
      }

      return NextResponse.json({
        agents,
        timeframe,
        recordCount: filteredData.length,
      })
    }

    if (action === 'export') {
      const overallStats = calculateStats(filteredData)
      const modelStats: Record<string, TokenStats> = {}
      const sessionStats: Record<string, TokenStats> = {}

      const modelGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.model]) acc[record.model] = []
        acc[record.model].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      for (const [model, records] of Object.entries(modelGroups)) {
        modelStats[model] = calculateStats(records)
      }

      const sessionGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.sessionId]) acc[record.sessionId] = []
        acc[record.sessionId].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)

      for (const [sessionId, records] of Object.entries(sessionGroups)) {
        sessionStats[sessionId] = calculateStats(records)
      }

      const exportData: ExportData = {
        usage: filteredData,
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats,
      }

      if (format === 'csv') {
        const headers = ['timestamp', 'agentName', 'model', 'sessionId', 'operation', 'inputTokens', 'outputTokens', 'totalTokens', 'cost', 'duration']
        const csvRows = [headers.join(',')]

        filteredData.forEach(record => {
          csvRows.push([
            new Date(record.timestamp).toISOString(),
            record.agentName,
            record.model,
            record.sessionId,
            record.operation,
            record.inputTokens,
            record.outputTokens,
            record.totalTokens,
            record.cost.toFixed(4),
            record.duration || 0,
          ].join(','))
        })

        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`,
          },
        })
      }

      return NextResponse.json(exportData, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.json`,
        },
      })
    }

    if (action === 'trends') {
      const now = Date.now()
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000
      const recentData = filteredData.filter(r => r.timestamp >= twentyFourHoursAgo)

      const hourlyTrends: Record<string, { tokens: number; cost: number; requests: number }> = {}

      recentData.forEach(record => {
        const hour = new Date(record.timestamp).toISOString().slice(0, 13) + ':00:00.000Z'
        if (!hourlyTrends[hour]) {
          hourlyTrends[hour] = { tokens: 0, cost: 0, requests: 0 }
        }
        hourlyTrends[hour].tokens += record.totalTokens
        hourlyTrends[hour].cost += record.cost
        hourlyTrends[hour].requests += 1
      })

      const trends = Object.entries(hourlyTrends)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timestamp, data]) => ({ timestamp, ...data }))

      return NextResponse.json({ trends, timeframe })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Tokens API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { model, sessionId, inputTokens, outputTokens, operation = 'chat_completion', duration } = body

    if (!model || !sessionId || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const totalTokens = inputTokens + outputTokens
    const costPer1k = getModelCost(model)
    const cost = (totalTokens / 1000) * costPer1k

    const record: TokenUsageRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      model,
      sessionId,
      agentName: extractAgentName(sessionId),
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation,
      duration,
    }

    // Persist only manually posted usage records in the JSON file.
    const existingData = await loadTokenDataFromFile()
    existingData.unshift(record)

    if (existingData.length > 10000) {
      existingData.splice(10000)
    }

    await saveTokenData(existingData)

    return NextResponse.json({ success: true, record })
  } catch (error) {
    logger.error({ err: error }, 'Error saving token usage')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
