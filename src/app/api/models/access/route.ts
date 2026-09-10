import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { detectModelAccess } from '@/lib/model-access'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  try {
    return NextResponse.json({ providers: detectModelAccess() })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/models/access error')
    return NextResponse.json({ providers: {} })
  }
}

export const dynamic = 'force-dynamic'
