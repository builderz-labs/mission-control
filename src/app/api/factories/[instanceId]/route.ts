import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getFactoryInstance } from '@/lib/factories/store'
import { getFactoryAdapter } from '@/lib/factories/registry'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const { instanceId } = await params
  const decoded = decodeURIComponent(instanceId)
  const instance = getFactoryInstance(ws.workspaceId, decoded)
  if (!instance) return NextResponse.json({ error: 'Factory instance not found' }, { status: 404 })

  const adapter = getFactoryAdapter(instance.adapter_id)
  return NextResponse.json({
    instance,
    definition: adapter?.getDefinition() || null,
  })
}
