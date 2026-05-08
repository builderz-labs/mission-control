import { getDatabase } from '@/lib/db'
import { getPolicy } from './runtime-limits'
import type { PolicyDecision, PolicyDenialCode } from './execution-policy'

export type { PolicyDecision, PolicyDenialCode }

function deny(code: PolicyDenialCode, reason: string): PolicyDecision {
  return { allowed: false, code, reason }
}

export interface DispatchContext {
  workspaceId: number
  agentName?: string | null
}

export function checkDispatchAllowed(ctx: DispatchContext): PolicyDecision {
  try {
    const policy = getPolicy(ctx.workspaceId)

    if (policy.maintenanceMode) {
      return deny('MAINTENANCE_MODE', 'System is in maintenance mode — dispatch suspended')
    }

    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    const runningCount = (db.prepare(
      "SELECT COUNT(*) as c FROM execution_runs WHERE workspace_id = ? AND status = 'running'"
    ).get(ctx.workspaceId) as { c: number }).c

    if (runningCount >= policy.maxConcurrentRuns) {
      return deny('MAX_CONCURRENT_RUNS', `Max concurrent runs (${policy.maxConcurrentRuns}) reached`)
    }

    const hourAgo = now - 3600
    const hourlyCount = (db.prepare(
      'SELECT COUNT(*) as c FROM execution_runs WHERE workspace_id = ? AND created_at >= ?'
    ).get(ctx.workspaceId, hourAgo) as { c: number }).c

    if (hourlyCount >= policy.maxTasksPerHour) {
      return deny('QUOTA_EXCEEDED', `Hourly dispatch quota (${policy.maxTasksPerHour}) exceeded`)
    }

    if (ctx.agentName) {
      const agentRunning = (db.prepare(
        "SELECT COUNT(*) as c FROM execution_runs WHERE workspace_id = ? AND agent_name = ? AND status = 'running'"
      ).get(ctx.workspaceId, ctx.agentName) as { c: number }).c

      if (agentRunning >= policy.maxConcurrentPerAgent) {
        return deny('MAX_CONCURRENT_AGENT', `Agent "${ctx.agentName}" at max concurrency (${policy.maxConcurrentPerAgent})`)
      }
    }

    return { allowed: true }
  } catch {
    return deny('POLICY_UNAVAILABLE', 'Policy engine unavailable — dispatch denied (fail-closed)')
  }
}
