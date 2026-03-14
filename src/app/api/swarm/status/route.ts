import { NextResponse } from 'next/server'
import { swarmOverlord } from '@/lib/swarm-overlord'

export async function GET() {
  try {
    const status = await swarmOverlord.getSwarmStatus()
    return NextResponse.json(status)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
