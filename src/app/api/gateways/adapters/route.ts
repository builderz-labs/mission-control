import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getAdapterInfo, getRegisteredTypes } from '@/lib/gateway'

/**
 * GET /api/gateways/adapters - List available gateway adapter types
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    adapters: getAdapterInfo(),
    registered_types: getRegisteredTypes(),
  })
}
