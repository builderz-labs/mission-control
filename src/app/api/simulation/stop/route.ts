import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getSimulationEngine } from '@/lib/simulation-engine'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const engine = getSimulationEngine()
    const status = engine.getStatus()
    engine.stop()
    return NextResponse.json({ status: 'stopped', tickCount: status.tickCount })
  } catch (err) {
    logger.error({ err }, 'POST /api/simulation/stop error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
