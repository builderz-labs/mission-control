import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getSecurityPosture } from '@/lib/security-events'
import { getMcpCallStats, verifyMcpCallReceipts } from '@/lib/mcp-audit'
import { runSecurityScan } from '@/lib/security-scan'

type Timeframe = 'hour' | 'day' | 'week' | 'month'

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  hour: 3600,
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const timeframe = (searchParams.get('timeframe') || 'day') as Timeframe
    const eventTypeFilter = searchParams.get('event_type')
    const severityFilter = searchParams.get('severity')
    const agentFilter = searchParams.get('agent')
    const workspaceId = auth.user.workspace_id ?? 1

    const seconds = TIMEFRAME_SECONDS[timeframe] || TIMEFRAME_SECONDS.day
    const since = Math.floor(Date.now() / 1000) - seconds
    const db = getDatabase()

    // Infrastructure scan (same as onboarding security scan)
    const scan = runSecurityScan()

    // Event-based posture (incidents, trust scores)
    const eventPosture = getSecurityPosture(workspaceId)

    // Blend: weighted average — 70% infrastructure config, 30% event history
    const blendedScore = Math.round(scan.score * 0.7 + eventPosture.score * 0.3)
    const level = blendedScore >= 90 ? 'hardened'
      : blendedScore >= 70 ? 'secure'
      : blendedScore >= 40 ? 'needs-attention'
      : 'at-risk'

    // Auth events
    const authEventsQuery = db.prepare(`
      SELECT event_type, severity, agent_name, detail, ip_address, created_at
      FROM security_events
      WHERE workspace_id = ? AND created_at > ?
        AND event_type IN ('auth.failure', 'auth.token_rotation', 'auth.access_denied')
      ORDER BY created_at DESC
      LIMIT 50
    `).all(workspaceId, since) as any[]

    const loginFailures = authEventsQuery.filter(e => e.event_type === 'auth.failure').length
    const tokenRotations = authEventsQuery.filter(e => e.event_type === 'auth.token_rotation').length
    const accessDenials = authEventsQuery.filter(e => e.event_type === 'auth.access_denied').length

    // Agent trust
    const agents = db.prepare(`
      SELECT agent_name, trust_score, last_anomaly_at,
        auth_failures + injection_attempts + rate_limit_hits + secret_exposures as anomalies
      FROM agent_trust_scores
      WHERE workspace_id = ?
      ORDER BY trust_score ASC
    `).all(workspaceId) as any[]

    const flaggedCount = agents.filter((a: any) => a.trust_score < 0.8).length

    // Secret exposures
    const secretEvents = db.prepare(`
      SELECT event_type, severity, agent_name, detail, created_at
      FROM security_events
      WHERE workspace_id = ? AND created_at > ? AND event_type = 'secret.exposure'
      ORDER BY created_at DESC
      LIMIT 20
    `).all(workspaceId, since) as any[]

    // MCP audit summary
    const mcpTotals = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(DISTINCT tool_name) as unique_tools,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
      FROM mcp_call_log
      WHERE workspace_id = ? AND created_at > ?
    `).get(workspaceId, since) as any

    const topTools = db.prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM mcp_call_log
      WHERE workspace_id = ? AND created_at > ?
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT 10
    `).all(workspaceId, since) as any[]

    const totalCalls = mcpTotals?.total_calls ?? 0
    const failureRate = totalCalls > 0
      ? Math.round(((mcpTotals?.failures ?? 0) / totalCalls) * 10000) / 100
      : 0

    // Rate limit hits
    const rateLimitEvents = db.prepare(`
      SELECT COUNT(*) as total
      FROM security_events
      WHERE workspace_id = ? AND created_at > ? AND event_type = 'rate_limit.hit'
    `).get(workspaceId, since) as any

    const rateLimitByIp = db.prepare(`
      SELECT ip_address, COUNT(*) as count
      FROM security_events
      WHERE workspace_id = ? AND created_at > ? AND event_type = 'rate_limit.hit' AND ip_address IS NOT NULL
      GROUP BY ip_address
      ORDER BY count DESC
      LIMIT 10
    `).all(workspaceId, since) as any[]

    // Injection attempts
    const injectionEvents = db.prepare(`
      SELECT event_type, severity, agent_name, detail, ip_address, created_at
      FROM security_events
      WHERE workspace_id = ? AND created_at > ? AND event_type = 'injection.attempt'
      ORDER BY created_at DESC
      LIMIT 20
    `).all(workspaceId, since) as any[]

    // Timeline (bucketed by hour)
    const bucketSize = timeframe === 'hour' ? 300 : 3600
    let timelineQuery = `
      SELECT
        (created_at / ${bucketSize}) * ${bucketSize} as bucket,
        COUNT(*) as event_count,
        MAX(CASE WHEN severity = 'critical' THEN 3 WHEN severity = 'warning' THEN 2 ELSE 1 END) as max_severity
      FROM security_events
      WHERE workspace_id = ? AND created_at > ?
    `
    const timelineParams: any[] = [workspaceId, since]

    if (eventTypeFilter) {
      timelineQuery += ' AND event_type = ?'
      timelineParams.push(eventTypeFilter)
    }
    if (severityFilter) {
      timelineQuery += ' AND severity = ?'
      timelineParams.push(severityFilter)
    }
    if (agentFilter) {
      timelineQuery += ' AND agent_name = ?'
      timelineParams.push(agentFilter)
    }

    timelineQuery += ' GROUP BY bucket ORDER BY bucket ASC'

    const timeline = db.prepare(timelineQuery).all(...timelineParams) as any[]

    const severityMap: Record<number, string> = { 3: 'critical', 2: 'warning', 1: 'info' }

    return NextResponse.json({
      posture: { score: blendedScore, level },
      scan: {
        score: scan.score,
        overall: scan.overall,
        categories: scan.categories,
      },
      authEvents: {
        loginFailures,
        tokenRotations,
        accessDenials,
        recentEvents: authEventsQuery.slice(0, 10),
      },
      agentTrust: {
        agents: agents.map((a: any) => ({
          name: a.agent_name,
          score: Math.round(a.trust_score * 100) / 100,
          anomalies: a.anomalies,
        })),
        flaggedCount,
      },
      secretExposures: {
        total: secretEvents.length,
        recent: secretEvents.slice(0, 5),
      },
      mcpAudit: {
        totalCalls,
        uniqueTools: mcpTotals?.unique_tools ?? 0,
        failureRate,
        topTools: topTools.map((t: any) => ({ name: t.tool_name, count: t.count })),
        receiptIntegrity: (() => {
          try {
            return verifyMcpCallReceipts(24, workspaceId)
          } catch {
            return null
          }
        })(),
      },
      rateLimits: {
        totalHits: rateLimitEvents?.total ?? 0,
        byIp: rateLimitByIp.map((r: any) => ({ ip: r.ip_address, count: r.count })),
      },
      injectionAttempts: {
        total: injectionEvents.length,
        recent: injectionEvents.slice(0, 5),
      },
      timeline: timeline.map((t: any) => ({
        timestamp: t.bucket,
        eventCount: t.event_count,
        severity: severityMap[t.max_severity] || 'info',
      })),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/security-audit error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
