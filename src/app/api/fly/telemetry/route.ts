import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { buildFlyTelemetry } from '@/lib/fly-telemetry'
import { getHostMetrics } from '@/lib/host-metrics'
import { logger } from '@/lib/logger'
import { buildFlyActivity } from '@/lib/fly-activity'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const denied = denyUnscopedResourceForStrictWorkspace(auth.user,'host_administration','/api/fly/telemetry')
  if (denied) return denied
  try {
    const db = getDatabase()
    return NextResponse.json({ ...buildFlyTelemetry(db, auth.user.workspace_id, await getHostMetrics()),
      activity: buildFlyActivity(db,auth.user.workspace_id) })
  } catch (err) {
    logger.error({ err }, 'Fly telemetry request failed')
    return NextResponse.json({ error: 'Unable to load Fly telemetry' }, { status: 500 })
  }
}
