import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { listFactoryAdapters } from '@/lib/factories/registry'
import { listFactoryApprovals, listFactoryInstances } from '@/lib/factories/store'
import { discoverAndRefreshFactories } from '@/lib/factories/service'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  try {
    const definitions = listFactoryAdapters().map((adapter) => adapter.getDefinition())
    const instances = listFactoryInstances(ws.workspaceId)
    const approvals = listFactoryApprovals(ws.workspaceId, ['OPEN', 'DECISION_RECORDED', 'APPLYING'])
    return NextResponse.json({ definitions, instances, approvals })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/factories error')
    return NextResponse.json({ error: 'Failed to list factories' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  try {
    const snapshots = await discoverAndRefreshFactories(ws.workspaceId)
    return NextResponse.json({ snapshots })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/factories refresh error')
    return NextResponse.json({ error: 'Failed to discover/refresh factories' }, { status: 500 })
  }
}
