/**
 * MCP Audit — logs and analyzes MCP tool calls per agent.
 *
 * Tracks every tool invocation with success/failure, duration, and error detail.
 * Provides aggregated stats for efficiency dashboards.
 */

import { getDatabase } from '@/lib/db'

export interface McpCallInput {
  agentName?: string
  mcpServer?: string
  toolName?: string
  success?: boolean
  durationMs?: number
  error?: string
  workspaceId?: number
}

export interface McpCallStats {
  totalCalls: number
  successCount: number
  failureCount: number
  successRate: number
  avgDurationMs: number
  toolBreakdown: Array<{
    toolName: string
    mcpServer: string
    calls: number
    successes: number
    failures: number
    avgDurationMs: number
  }>
}

export function logMcpCall(input: McpCallInput): number {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO mcp_call_log (agent_name, mcp_server, tool_name, success, duration_ms, error, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.agentName ?? null,
    input.mcpServer ?? null,
    input.toolName ?? null,
    input.success !== false ? 1 : 0,
    input.durationMs ?? null,
    input.error ?? null,
    input.workspaceId ?? 1,
  )
  return result.lastInsertRowid as number
}

export function getMcpCallStats(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): McpCallStats {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as { total: number; successes: number; failures: number; avg_duration: number | null } | undefined

  interface McpBreakdownRow {
    tool_name: string | null
    mcp_server: string | null
    calls: number
    successes: number
    failures: number
    avg_duration: number | null
  }

  const breakdown = db.prepare(`
    SELECT
      tool_name,
      mcp_server,
      COUNT(*) as calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
    GROUP BY tool_name, mcp_server
    ORDER BY calls DESC
  `).all(agentName, workspaceId, since) as McpBreakdownRow[]

  const total = totals?.total ?? 0
  const successCount = totals?.successes ?? 0
  const failureCount = totals?.failures ?? 0

  return {
    totalCalls: total,
    successCount,
    failureCount,
    successRate: total > 0 ? Math.round((successCount / total) * 10000) / 100 : 100,
    avgDurationMs: Math.round(totals?.avg_duration ?? 0),
    toolBreakdown: breakdown.map((row) => ({
      toolName: row.tool_name ?? 'unknown',
      mcpServer: row.mcp_server ?? 'unknown',
      calls: row.calls,
      successes: row.successes,
      failures: row.failures,
      avgDurationMs: Math.round(row.avg_duration ?? 0),
    })),
  }
}
