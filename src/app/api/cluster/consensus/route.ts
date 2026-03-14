import { NextResponse } from 'next/server'
import { consensusEngine } from '@/lib/consensus-engine'
import { requireClusterAuth } from '@/lib/auth'

export async function POST(req: Request) {
  const auth = requireClusterAuth(req)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const payload = await req.json()
    const response = consensusEngine.handleIncoming(payload)
    return NextResponse.json(response)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json(consensusEngine.getStatus())
}
