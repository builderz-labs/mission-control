import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getMissionControlEvents } from '@/lib/mission-control-status'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || '60'), 200)
    return NextResponse.json({ events: getMissionControlEvents(limit) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/status/events error')
    return NextResponse.json({ error: 'Failed to fetch mission control events' }, { status: 500 })
  }
}
