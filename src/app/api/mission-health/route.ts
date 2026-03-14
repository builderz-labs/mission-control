import { NextResponse } from 'next/server'
import { Session } from '@/types'
import { trackAllProjects, syncGitHealth } from '@/lib/project-tracker'
import { syncClaudeSessions, getBurnForecast } from '@/lib/claude-sessions'
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
    const burnForecastPromise = getBurnForecast()
    
    // Get project health (including git info)
    const projects = trackAllProjects()
    const sovereignty = await SovereigntyPolicyService.evaluateFleet()
    const sovereigntyStatus = sovereignty.length > 0 ? 'breached' : 'nominal'
    
    const [_, __, burnForecast] = await Promise.all([claudeSyncPromise, gitSyncPromise, burnForecastPromise])

    // Fetch deep metrics for the dashboard
    const activeSessions = db.prepare(`
      SELECT session_id, project_slug, model, git_branch,
             user_messages, assistant_messages, tool_uses,
             tool_success_count, tool_error_count, total_loc_delta,
             loc_by_language, stability_score, alert_status,
             is_sidechain, tool_timeline, parent_session_id, intent_task,
             last_message_at, last_user_prompt, is_active,
             history_stability, area
      FROM claude_sessions 
      WHERE is_active = 1 OR last_message_at > datetime('now', '-5 minutes')
      ORDER BY last_message_at DESC
    `).all().map((s: any) => ({
      ...s,
      history_stability: JSON.parse(s.history_stability || '[]')
    })) as Session[]

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
      burnForecast,
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
