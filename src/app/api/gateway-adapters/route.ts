import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getGatewayAdaptersFromEnv } from '@/lib/gateway-adapters'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const adapters = getGatewayAdaptersFromEnv()
  return NextResponse.json({ adapters })
}
