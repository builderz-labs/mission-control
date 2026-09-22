import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { JEV_DEFAULT_MODEL, JEV_SDK_VERSION } from '@/lib/jev-client'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { readLimiter } from '@/lib/rate-limit'
import { isJevAssistantAvailable } from '@/lib/jev-assistant-provider'
import { jevAssistantOptions, resolveJevAssistantProvider } from '@/lib/jev-assistant-config'
import { getJevHealth } from '@/lib/jev-health'
import { getJevCloudStatus } from '@/lib/jev-cloud-sync'
import { reconcileStaleJevEvaluations } from '@/lib/jev-repository'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const db = getDatabase()
    const health = await getJevHealth()
    const workspaceId = auth.user.workspace_id
    reconcileStaleJevEvaluations(workspaceId, 300, db)
    const counts = db.prepare(`
      SELECT COUNT(*) AS evaluation_count,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS successful_count,
        MAX(created_at) AS last_evaluation_at
      FROM jev_evaluations WHERE workspace_id=?
    `).get(workspaceId) as { evaluation_count: number; successful_count: number | null; last_evaluation_at: number | null }
    const policy = db.prepare('SELECT COUNT(*) AS count FROM jev_policies WHERE workspace_id=?')
      .get(workspaceId) as { count: number }

    const assistantOptions = jevAssistantOptions(await isJevAssistantAvailable())
    const assistantDefault = resolveJevAssistantProvider()
    return NextResponse.json({ status: {
      configured: health.configured,
      healthy: health.healthy,
      healthError: health.errorCode,
      lastCheckedAt: health.lastCheckedAt,
      assistantAvailable: assistantOptions.some((option) => option.configured),
      assistantProvider: assistantOptions.find((option) => option.kind === assistantDefault)?.label ?? 'Claude Code',
      assistantDefault,
      assistantOptions,
      defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || JEV_DEFAULT_MODEL,
      sdkVersion: JEV_SDK_VERSION,
      policyCount: policy.count,
      evaluationCount: counts.evaluation_count,
      successfulCount: counts.successful_count ?? 0,
      lastEvaluationAt: counts.last_evaluation_at,
      cloud: getJevCloudStatus(workspaceId, db),
    } })
  } catch (error) {
    return jevErrorResponse(error, 'read status')
  }
}
