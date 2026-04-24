import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { approveItem } from '@/lib/jk/approval-queue'
import { triggerNextGate } from '@/lib/jk/gate-unlock'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const itemId = parseInt(id, 10)
  if (isNaN(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    approveItem(itemId, auth.user.username)
    // Unlock the next gate (scaffold Gate N+1 as pending)
    triggerNextGate(itemId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404
      : err.message?.includes('status') ? 409
      : err.message?.includes('Gate') ? 409
      : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
