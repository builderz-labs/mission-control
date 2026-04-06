import { NextRequest, NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import { dirname } from 'path'
import { config, ensureDirExists } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { getAllGatewaySessions } from '@/lib/sessions'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { calculateTokenCost } from '@/lib/token-pricing'
import { getProviderSubscriptionFlags } from '@/lib/provider-subscriptions'
import {
  buildStatsResponse,
  buildAgentCostsResponse,
  buildTaskCostsResponse,
  buildExportResponse,
  buildTrendsResponse,
} from './response-builders'

export const DATA_PATH = config.tokensPath

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface TokenUsageRecord {
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
  taskId?: number | null
  workspaceId?: number
  duration?: number
}

export interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

interface DbTokenUsageRow {
  id: number
  model: string
  session_id: string
  input_tokens: number
  output_tokens: number
  task_id?: number | null
  workspace_id?: number
  created_at: number
}

// ---------------------------------------------------------------------------
// Shared utilities (exported so POST handler can reuse them)
// ---------------------------------------------------------------------------

export function extractAgentName(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (!trimmed) return 'unknown'
  const [agent] = trimmed.split(':')
  return agent?.trim() || 'unknown'
}

export function calculateStats(records: TokenUsageRecord[]): TokenStats {
  if (records.length === 0) {
    return { totalTokens: 0, totalCost: 0, requestCount: 0, avgTokensPerRequest: 0, avgCostPerRequest: 0 }
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
  const cutoffs: Record<string, number> = {
    hour: now - 60 * 60 * 1000,
    day: now - 24 * 60 * 60 * 1000,
    week: now - 7 * 24 * 60 * 60 * 1000,
    month: now - 30 * 24 * 60 * 60 * 1000,
  }
  const cutoff = cutoffs[timeframe]
  return cutoff ? records.filter((r) => r.timestamp >= cutoff) : records
}

export function normalizeTokenRecord(
  record: Partial<TokenUsageRecord>,
  providerSubscriptions: Record<string, boolean>,
): TokenUsageRecord | null {
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
    cost: Number(record.cost ?? calculateTokenCost(model, inputTokens, outputTokens, { providerSubscriptions })),
    operation: String(record.operation ?? 'chat_completion'),
    taskId: record.taskId != null && Number.isFinite(Number(record.taskId)) ? Number(record.taskId) : null,
    workspaceId: record.workspaceId != null && Number.isFinite(Number(record.workspaceId)) ? Number(record.workspaceId) : 1,
    duration: record.duration,
  }
}

function dedupeTokenRecords(records: TokenUsageRecord[]): TokenUsageRecord[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = [
      record.sessionId, record.model, record.timestamp,
      record.inputTokens, record.outputTokens, record.totalTokens,
      record.operation, record.taskId ?? '', record.workspaceId ?? 1, record.duration ?? '',
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function loadTokenDataFromDb(workspaceId: number, providerSubscriptions: Record<string, boolean>): TokenUsageRecord[] {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT id, model, session_id, input_tokens, output_tokens, task_id, workspace_id, created_at
      FROM token_usage
      WHERE workspace_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 10000
    `).all(workspaceId) as DbTokenUsageRow[]

    return rows.map((row) => {
      const totalTokens = row.input_tokens + row.output_tokens
      return {
        id: `db-${row.id}`,
        model: row.model,
        sessionId: row.session_id,
        agentName: extractAgentName(row.session_id),
        timestamp: row.created_at * 1000,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens,
        cost: calculateTokenCost(row.model, row.input_tokens, row.output_tokens, { providerSubscriptions }),
        operation: 'heartbeat',
        taskId: row.task_id ?? null,
        workspaceId: row.workspace_id ?? workspaceId,
      }
    })
  } catch (error) {
    logger.warn({ err: error }, 'Failed to load token usage from database')
    return []
  }
}

export async function loadTokenDataFromFile(workspaceId: number, providerSubscriptions: Record<string, boolean>): Promise<TokenUsageRecord[]> {
  try {
    ensureDirExists(dirname(DATA_PATH))
    await access(DATA_PATH)
    const data = await readFile(DATA_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((record: Partial<TokenUsageRecord>) => normalizeTokenRecord(record, providerSubscriptions))
      .filter((record): record is TokenUsageRecord => record !== null)
      .filter((record) => {
        if (record.workspaceId === workspaceId) return true
        // Backward compatibility: include pre-workspace records for workspace 1
        return workspaceId === 1 && (!record.workspaceId || record.workspaceId === 1)
      })
  } catch {
    return []
  }
}

/**
 * Derive token usage records from OpenClaw session stores.
 * Each session has totalTokens, inputTokens, outputTokens, model, etc.
 */
function deriveFromSessions(workspaceId: number, providerSubscriptions: Record<string, boolean>): TokenUsageRecord[] {
  const sessions = getAllGatewaySessions(Infinity)
  const records: TokenUsageRecord[] = sessions
    .filter((session) => (session.inputTokens || 0) + (session.outputTokens || 0) > 0 || session.model)
    .map((session) => {
      const inputTokens = session.inputTokens || 0
      const outputTokens = session.outputTokens || 0
      return {
        id: `session-${session.agent}-${session.key}`,
        model: session.model || 'unknown',
        sessionId: `${session.agent}:${session.chatType}`,
        agentName: session.agent || 'unknown',
        timestamp: session.updatedAt,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: calculateTokenCost(session.model || '', inputTokens, outputTokens, { providerSubscriptions }),
        operation: session.chatType || 'chat',
        taskId: null,
        workspaceId,
      }
    })

  return records.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Load token data from all sources (DB, file, gateway sessions), merge, and deduplicate.
 */
export async function loadTokenData(workspaceId: number): Promise<TokenUsageRecord[]> {
  const providerSubscriptions = getProviderSubscriptionFlags()
  const dbRecords = loadTokenDataFromDb(workspaceId, providerSubscriptions)
  const fileRecords = await loadTokenDataFromFile(workspaceId, providerSubscriptions)
  const sessionRecords = deriveFromSessions(workspaceId, providerSubscriptions)
  return dedupeTokenRecords([...dbRecords, ...fileRecords, ...sessionRecords])
    .sort((a, b) => b.timestamp - a.timestamp)
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function handleGetTokens(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = (searchParams.get('action') || 'list').trim().toLowerCase()
    const timeframe = searchParams.get('timeframe') || 'all'
    const format = searchParams.get('format') || 'json'
    const workspaceId = auth.user.workspace_id ?? 1

    const tokenData = await loadTokenData(workspaceId)
    const filteredData = filterByTimeframe(tokenData, timeframe)

    if (action === 'list') {
      return NextResponse.json({ usage: filteredData.slice(0, 100), total: filteredData.length, timeframe })
    }
    if (action === 'stats') return buildStatsResponse(filteredData, timeframe)
    if (action === 'agent-costs') return buildAgentCostsResponse(filteredData, timeframe)
    if (action === 'task-costs' || action === 'task_costs' || action === 'taskcosts') {
      return buildTaskCostsResponse(workspaceId, filteredData, timeframe)
    }
    if (action === 'export') return buildExportResponse(filteredData, timeframe, format)
    if (action === 'trends') return buildTrendsResponse(filteredData, timeframe)

    return NextResponse.json({ error: 'Invalid action', action }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Tokens API GET error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
