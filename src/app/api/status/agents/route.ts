import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getMissionControlAgents } from '@/lib/mission-control-status'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    return NextResponse.json(getMissionControlAgents())
  } catch (error) {
    logger.error({ err: error }, 'GET /api/status/agents error')
    return NextResponse.json({ error: 'Failed to fetch mission control agents' }, { status: 500 })
  }
}
