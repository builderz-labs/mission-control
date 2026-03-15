import { NextRequest, NextResponse } from 'next/server'
import { swarmOverlord } from '@/lib/swarm-overlord'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const status = await swarmOverlord.getSwarmStatus()
    return NextResponse.json(status)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
