/**
 * MCP Audit — logs and analyzes MCP tool calls per agent.
 *
 * Tracks every tool invocation with success/failure, duration, and error detail.
 * Provides aggregated stats for efficiency dashboards.
 *
 * When receipt signing is enabled (standard/strict hook profiles), each audit
 * record is Ed25519-signed at write time, producing a tamper-evident receipt.
 * Verification recomputes the hash and checks the signature — if a record is
 * modified after signing, verification fails.
 */

import { getDatabase } from '@/lib/db'
import { signAuditRecord, verifyAuditRecord } from '@/lib/receipt-signing'

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
  const timestamp = Math.floor(Date.now() / 1000)
  const success = input.success !== false ? 1 : 0

  // Build the audit payload for receipt signing
  const payload: Record<string, unknown> = {
    agent_name: input.agentName ?? null,
    mcp_server: input.mcpServer ?? null,
    tool_name: input.toolName ?? null,
    success,
    duration_ms: input.durationMs ?? null,
    error: input.error ?? null,
    workspace_id: input.workspaceId ?? 1,
    created_at: timestamp,
  }

  // Sign the audit record (Ed25519, ~0.3ms overhead)
  let payloadHash: string | null = null
  let signature: string | null = null
  let publicKey: string | null = null

  try {
    const receipt = signAuditRecord(payload)
    payloadHash = receipt.payloadHash
    signature = receipt.signature
    publicKey = receipt.publicKey
  } catch {
    // Signing failure is non-fatal — the audit record is still logged
  }

  const result = db.prepare(`
    INSERT INTO mcp_call_log (
      agent_name, mcp_server, tool_name, success, duration_ms, error,
      workspace_id, created_at, payload_hash, signature, public_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.agentName ?? null,
    input.mcpServer ?? null,
    input.toolName ?? null,
    success,
    input.durationMs ?? null,
    input.error ?? null,
    input.workspaceId ?? 1,
    timestamp,
    payloadHash,
    signature,
    publicKey,
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
  `).get(agentName, workspaceId, since) as any

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
  `).all(agentName, workspaceId, since) as any[]

  const total = totals?.total ?? 0
  const successCount = totals?.successes ?? 0
  const failureCount = totals?.failures ?? 0

  return {
    totalCalls: total,
    successCount,
    failureCount,
    successRate: total > 0 ? Math.round((successCount / total) * 10000) / 100 : 100,
    avgDurationMs: Math.round(totals?.avg_duration ?? 0),
    toolBreakdown: breakdown.map((row: any) => ({
      toolName: row.tool_name ?? 'unknown',
      mcpServer: row.mcp_server ?? 'unknown',
      calls: row.calls,
      successes: row.successes,
      failures: row.failures,
      avgDurationMs: Math.round(row.avg_duration ?? 0),
    })),
  }
}

/**
 * Verify a specific MCP audit record's receipt.
 *
 * Reconstructs the canonical payload from the stored fields,
 * recomputes the SHA-256 hash, and checks the Ed25519 signature.
 * Returns false if the record has been tampered with.
 */
export function verifyMcpCallReceipt(recordId: number): {
  valid: boolean
  record: Record<string, unknown> | null
  error?: string
} {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT * FROM mcp_call_log WHERE id = ?'
  ).get(recordId) as any

  if (!row) return { valid: false, record: null, error: 'Record not found' }

  if (!row.signature || !row.public_key) {
    return { valid: false, record: row, error: 'Record was not signed' }
  }

  // Reconstruct the payload that was signed (same fields, same order)
  const payload: Record<string, unknown> = {
    agent_name: row.agent_name,
    mcp_server: row.mcp_server,
    tool_name: row.tool_name,
    success: row.success,
    duration_ms: row.duration_ms,
    error: row.error,
    workspace_id: row.workspace_id,
    created_at: row.created_at,
  }

  const valid = verifyAuditRecord(payload, row.signature, row.public_key)

  return {
    valid,
    record: payload,
    error: valid ? undefined : 'Signature verification failed — record may have been tampered with',
  }
}

/**
 * Verify all MCP audit records in a time range.
 * Returns summary statistics for the audit integrity check.
 */
export function verifyMcpCallReceipts(
  hours: number = 24,
  workspaceId: number = 1,
): {
  total: number
  signed: number
  verified: number
  failed: number
  unsigned: number
} {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const rows = db.prepare(`
    SELECT id, agent_name, mcp_server, tool_name, success, duration_ms,
           error, workspace_id, created_at, signature, public_key
    FROM mcp_call_log
    WHERE workspace_id = ? AND created_at > ?
  `).all(workspaceId, since) as any[]

  let signed = 0
  let verified = 0
  let failed = 0
  let unsigned = 0

  for (const row of rows) {
    if (!row.signature || !row.public_key) {
      unsigned++
      continue
    }
    signed++

    const payload: Record<string, unknown> = {
      agent_name: row.agent_name,
      mcp_server: row.mcp_server,
      tool_name: row.tool_name,
      success: row.success,
      duration_ms: row.duration_ms,
      error: row.error,
      workspace_id: row.workspace_id,
      created_at: row.created_at,
    }

    if (verifyAuditRecord(payload, row.signature, row.public_key)) {
      verified++
    } else {
      failed++
    }
  }

  return { total: rows.length, signed, verified, failed, unsigned }
}
