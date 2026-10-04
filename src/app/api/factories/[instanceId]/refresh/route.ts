import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { refreshFactoryInstance } from '@/lib/factories/service'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const { instanceId } = await params
  try {
    const snapshot = await refreshFactoryInstance(ws.workspaceId, decodeURIComponent(instanceId))
    return NextResponse.json({ snapshot })
  } catch (error) {
    logger.error({ err: error, instanceId }, 'POST factory refresh error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Factory refresh failed' }, { status: 500 })
  }
}
