import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { JEV_DEFAULT_MODEL, JEV_SDK_VERSION } from '@/lib/jev-client'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { readLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const counts = db.prepare(`
      SELECT COUNT(*) AS evaluation_count,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS successful_count,
        MAX(created_at) AS last_evaluation_at
      FROM jev_evaluations WHERE workspace_id=?
    `).get(workspaceId) as { evaluation_count: number; successful_count: number | null; last_evaluation_at: number | null }
    const policy = db.prepare('SELECT COUNT(*) AS count FROM jev_policies WHERE workspace_id=?')
      .get(workspaceId) as { count: number }

    return NextResponse.json({ status: {
      configured: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
      defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || JEV_DEFAULT_MODEL,
      sdkVersion: JEV_SDK_VERSION,
      policyCount: policy.count,
      evaluationCount: counts.evaluation_count,
      successfulCount: counts.successful_count ?? 0,
      lastEvaluationAt: counts.last_evaluation_at,
    } })
  } catch (error) {
    return jevErrorResponse(error, 'read status')
  }
}
