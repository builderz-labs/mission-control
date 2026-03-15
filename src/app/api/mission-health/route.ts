import { NextResponse } from 'next/server'
import type { ClaudeSessionRow } from '@/types'
import { trackAllProjects, syncGitHealth } from '@/lib/project-tracker'
import { syncClaudeSessions } from '@/lib/claude-sessions'
import { getDatabase } from '@/lib/db'
import { SovereigntyPolicyService } from '@/lib/services/sovereignty-policy-service'

/**
 * GET /api/mission-health
 * Returns health metrics for all mission-control projects and triggers a Claude session sync.
 */
export async function GET() {
  try {
    const db = getDatabase()

    // Trigger syncs
    const claudeSyncPromise = syncClaudeSessions()
    const gitSyncPromise = syncGitHealth()

    // Get project health (including git info)
    const projects = trackAllProjects()
    const sovereignty = await SovereigntyPolicyService.evaluateFleet()
    const sovereigntyStatus = sovereignty.length > 0 ? 'breached' : 'nominal'

    await Promise.all([claudeSyncPromise, gitSyncPromise])

    // Fetch deep metrics for the dashboard
    const activeSessions = db.prepare(`
      SELECT *
      FROM claude_sessions
      WHERE is_active = 1 OR last_message_at > datetime('now', '-5 minutes')
      ORDER BY last_message_at DESC
    `).all() as ClaudeSessionRow[]

    const sessionStats = db.prepare(`
      SELECT SUM(total_loc_delta) as total_loc,
             SUM(tool_success_count) as total_successes,
             SUM(tool_error_count) as total_errors,
             SUM(estimated_cost) as total_cost
      FROM claude_sessions
    `).get()

    return NextResponse.json({
      projects,
      activeSessions,
      stats: sessionStats,
      sovereignty: {
        status: sovereigntyStatus,
        violations: sovereignty
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch mission health', details: error.message },
      { status: 500 }
    )
  }
}
