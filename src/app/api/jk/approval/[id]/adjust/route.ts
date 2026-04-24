import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { adjustItem } from '@/lib/jk/approval-queue'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const itemId = parseInt(id, 10)
  if (isNaN(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { adjustment_text?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const text = (body.adjustment_text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'adjustment_text is required' }, { status: 400 })

  try {
    const newId = adjustItem(itemId, text, auth.user.username)
    return NextResponse.json({ success: true, new_id: newId })
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('status') ? 409 : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
