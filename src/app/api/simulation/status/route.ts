import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSimulationEngine } from '@/lib/simulation-engine'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const engine = getSimulationEngine()
  return NextResponse.json(engine.getStatus())
}
