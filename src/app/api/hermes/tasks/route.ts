import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getHermesTasks } from '@/lib/hermes-tasks'

/**
 * GET /api/hermes/tasks — Returns Hermes cron jobs
 * Read-only bridge: MC reads from ~/.hermes/cron/
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const force = request.nextUrl.searchParams.get('force') === 'true'
  const result = getHermesTasks(force)

  return NextResponse.json(result)
}
