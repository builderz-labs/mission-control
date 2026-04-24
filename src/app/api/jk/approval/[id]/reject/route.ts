import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { rejectItem, RejectionCategory } from '@/lib/jk/approval-queue'

const VALID_CATEGORIES: RejectionCategory[] = ['wrong_format', 'wrong_direction', 'data_error', 'other']

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const itemId = parseInt(id, 10)
  if (isNaN(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { rejection_reason?: string; rejection_category?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const reason = (body.rejection_reason ?? '').trim()
  const category = (body.rejection_category ?? 'other') as RejectionCategory
  if (!reason) return NextResponse.json({ error: 'rejection_reason is required' }, { status: 400 })
  if (!VALID_CATEGORIES.includes(category)) return NextResponse.json({ error: 'Invalid rejection_category' }, { status: 400 })

  try {
    rejectItem({ id: itemId, rejection_reason: reason, rejection_category: category, decided_by: auth.user.username })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('status') ? 409 : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
