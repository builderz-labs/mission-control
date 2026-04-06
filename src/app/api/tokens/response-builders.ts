/**
 * Response builder functions for the tokens GET handler.
 * Each builder handles one action variant and returns a fully-formed NextResponse.
 * Extracted here to keep get-handler.ts under the 400-line project limit.
 */
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { buildTaskCostReport, type TaskCostMetadata } from '@/lib/task-costs'
import { calculateStats, extractAgentName, type TokenUsageRecord, type TokenStats } from './get-handler'

// Re-export so callers that previously imported from get-handler still compile
export type { TokenStats }

interface ExportData {
  usage: TokenUsageRecord[]
  summary: TokenStats
  models: Record<string, TokenStats>
  sessions: Record<string, TokenStats>
}

interface TaskMetadataRow extends TaskCostMetadata {}

// ---------------------------------------------------------------------------
// Local grouping helpers (private to this module)
// ---------------------------------------------------------------------------

function groupBy<K extends string>(
  records: TokenUsageRecord[],
  key: (r: TokenUsageRecord) => K,
): Record<K, TokenUsageRecord[]> {
  return records.reduce((acc, r) => {
    const k = key(r)
    return { ...acc, [k]: [...(acc[k] ?? []), r] }
  }, {} as Record<K, TokenUsageRecord[]>)
}

function toStats(groups: Record<string, TokenUsageRecord[]>): Record<string, TokenStats> {
  const out: Record<string, TokenStats> = {}
  for (const [k, records] of Object.entries(groups)) out[k] = calculateStats(records)
  return out
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildStatsResponse(filteredData: TokenUsageRecord[], timeframe: string): NextResponse {
  const overallStats = calculateStats(filteredData)
  return NextResponse.json({
    summary: overallStats,
    models: toStats(groupBy(filteredData, (r) => r.model)),
    sessions: toStats(groupBy(filteredData, (r) => r.sessionId)),
    agents: toStats(groupBy(filteredData, (r) => r.agentName || extractAgentName(r.sessionId))),
    timeframe,
    recordCount: filteredData.length,
  })
}

export function buildAgentCostsResponse(filteredData: TokenUsageRecord[], timeframe: string): NextResponse {
  const agentGroups = groupBy(filteredData, (r) => r.agentName || extractAgentName(r.sessionId))

  const agents: Record<string, {
    stats: TokenStats
    models: Record<string, TokenStats>
    sessions: string[]
    timeline: Array<{ date: string; cost: number; tokens: number }>
  }> = {}

  for (const [agent, records] of Object.entries(agentGroups)) {
    const modelGroups = groupBy(records, (r) => r.model)

    const dailyMap = records.reduce((acc, r) => {
      const date = new Date(r.timestamp).toISOString().split('T')[0]
      const prev = acc[date] ?? { cost: 0, tokens: 0 }
      return { ...acc, [date]: { cost: prev.cost + r.cost, tokens: prev.tokens + r.totalTokens } }
    }, {} as Record<string, { cost: number; tokens: number }>)

    agents[agent] = {
      stats: calculateStats(records),
      models: toStats(modelGroups),
      sessions: [...new Set(records.map((r) => r.sessionId))],
      timeline: Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data })),
    }
  }

  return NextResponse.json({ agents, timeframe, recordCount: filteredData.length })
}

export function buildTaskCostsResponse(
  workspaceId: number,
  filteredData: TokenUsageRecord[],
  timeframe: string,
): NextResponse {
  const attributedTaskIds = [
    ...new Set(
      filteredData
        .map((r) => r.taskId)
        .filter((id): id is number => Number.isFinite(id) && Number(id) > 0)
        .map(Number),
    ),
  ]

  const taskMetadataById: Record<number, TaskCostMetadata> = {}
  if (attributedTaskIds.length > 0) {
    const db = getDatabase()
    const placeholders = attributedTaskIds.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.assigned_to, t.project_id,
             p.name as project_name, p.slug as project_slug, p.ticket_prefix as project_prefix,
             t.project_ticket_no
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ? AND t.id IN (${placeholders})
    `).all(workspaceId, ...attributedTaskIds) as TaskMetadataRow[]

    for (const row of rows) taskMetadataById[row.id] = row
  }

  const report = buildTaskCostReport(
    filteredData.map((r) => ({
      model: r.model,
      agentName: r.agentName || extractAgentName(r.sessionId),
      timestamp: r.timestamp,
      totalTokens: r.totalTokens,
      cost: r.cost,
      taskId: r.taskId ?? null,
    })),
    taskMetadataById,
  )

  return NextResponse.json({
    ...report,
    timeframe,
    recordCount: filteredData.length,
    attributedRecordCount: filteredData.filter((r) => Number.isFinite(r.taskId)).length,
  })
}

export function buildExportResponse(
  filteredData: TokenUsageRecord[],
  timeframe: string,
  format: string,
): NextResponse {
  const dateStr = new Date().toISOString().split('T')[0]

  if (format === 'csv') {
    const headers = [
      'timestamp', 'agentName', 'model', 'sessionId', 'operation',
      'inputTokens', 'outputTokens', 'totalTokens', 'cost', 'duration',
    ]
    const csvRows = [
      headers.join(','),
      ...filteredData.map((r) =>
        [
          new Date(r.timestamp).toISOString(),
          r.agentName, r.model, r.sessionId, r.operation,
          r.inputTokens, r.outputTokens, r.totalTokens,
          r.cost.toFixed(4), r.duration || 0,
        ].join(','),
      ),
    ]
    return new NextResponse(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${dateStr}.csv`,
      },
    })
  }

  const modelGroups = groupBy(filteredData, (r) => r.model)
  const sessionGroups = groupBy(filteredData, (r) => r.sessionId)
  const exportData: ExportData = {
    usage: filteredData,
    summary: calculateStats(filteredData),
    models: toStats(modelGroups),
    sessions: toStats(sessionGroups),
  }
  return NextResponse.json(exportData, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${dateStr}.json`,
    },
  })
}

export function buildTrendsResponse(filteredData: TokenUsageRecord[], timeframe: string): NextResponse {
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
  const recentData = filteredData.filter((r) => r.timestamp >= twentyFourHoursAgo)

  const hourlyTrends = recentData.reduce((acc, record) => {
    const hour = new Date(record.timestamp).toISOString().slice(0, 13) + ':00:00.000Z'
    const prev = acc[hour] ?? { tokens: 0, cost: 0, requests: 0 }
    return {
      ...acc,
      [hour]: { tokens: prev.tokens + record.totalTokens, cost: prev.cost + record.cost, requests: prev.requests + 1 },
    }
  }, {} as Record<string, { tokens: number; cost: number; requests: number }>)

  const trends = Object.entries(hourlyTrends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, data]) => ({ timestamp, ...data }))

  return NextResponse.json({ trends, timeframe })
}
