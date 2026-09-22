import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listJevModels } from '@/lib/jev-client'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { heavyLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = heavyLimiter(request)
  if (limited) return limited
  try {
    return NextResponse.json({ models: await listJevModels() })
  } catch (error) {
    return jevErrorResponse(error, 'list models')
  }
}
