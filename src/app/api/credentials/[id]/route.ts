import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

/** PUT /api/credentials/[id] — update a credential's value/description */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as any
    if (!existing) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })

    const body = await request.json()
    const { value, description, name } = body
    const now = Math.floor(Date.now() / 1000)

    const fields: string[] = ['updated_at = ?']
    const vals: any[] = [now]
    if (value !== undefined) { fields.push('value = ?'); vals.push(value.trim()) }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description?.trim() || null) }
    if (name !== undefined) { fields.push('name = ?'); vals.push(name.trim()) }
    vals.push(id)

    db.prepare(`UPDATE credentials SET ${fields.join(', ')} WHERE id = ?`).run(...vals)

    const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as any
    const user = getUserFromRequest(request)
    logAuditEvent({
      action: 'credential_update',
      actor: user?.username || 'unknown',
      target_type: 'credential',
      target_id: Number(id),
      detail: { name: updated.name },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    })

    return NextResponse.json({ credential: { ...updated, value: maskValue(updated.value) } })
  } catch (err: any) {
    logger.error({ err }, 'PUT /api/credentials/[id] error')
    return NextResponse.json({ error: 'Failed to update credential' }, { status: 500 })
  }
}

/** DELETE /api/credentials/[id] — remove a credential */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getDatabase()
    const existing = db.prepare('SELECT name, type FROM credentials WHERE id = ?').get(id) as any
    if (!existing) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })

    db.prepare('DELETE FROM credentials WHERE id = ?').run(id)

    const user = getUserFromRequest(request)
    logAuditEvent({
      action: 'credential_delete',
      actor: user?.username || 'unknown',
      target_type: 'credential',
      target_id: Number(id),
      detail: { name: existing.name, type: existing.type },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    logger.error({ err }, 'DELETE /api/credentials/[id] error')
    return NextResponse.json({ error: 'Failed to delete credential' }, { status: 500 })
  }
}

/** GET /api/credentials/[id] — reveal actual value (for copy) */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as any
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ value: row.value })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/credentials/[id] error')
    return NextResponse.json({ error: 'Failed to fetch credential' }, { status: 500 })
  }
}
