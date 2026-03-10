import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const VALID_TYPES = ['api_key', 'email', 'url', 'secret', 'other'] as const

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

/** GET /api/credentials — list all credentials (masked values) */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT id, name, type, value, description, created_at, updated_at FROM credentials ORDER BY created_at DESC'
    ).all() as Array<{ id: number; name: string; type: string; value: string; description: string | null; created_at: number; updated_at: number }>

    return NextResponse.json({
      credentials: rows.map(r => ({ ...r, value: maskValue(r.value) }))
    })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/credentials error')
    return NextResponse.json({ error: 'Failed to fetch credentials' }, { status: 500 })
  }
}

/** POST /api/credentials — create a credential */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { name, type = 'api_key', value, description } = body

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!value?.trim()) return NextResponse.json({ error: 'value is required' }, { status: 400 })
    if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })

    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(
      'INSERT INTO credentials (name, type, value, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), type, value.trim(), description?.trim() || null, now, now)

    const user = getUserFromRequest(request)
    logAuditEvent({
      action: 'credential_create',
      actor: user?.username || 'unknown',
      target_type: 'credential',
      target_id: result.lastInsertRowid as number,
      detail: { name: name.trim(), type },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    })

    return NextResponse.json({
      credential: { id: result.lastInsertRowid, name: name.trim(), type, value: maskValue(value.trim()), description: description?.trim() || null, created_at: now, updated_at: now }
    }, { status: 201 })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/credentials error')
    return NextResponse.json({ error: 'Failed to create credential' }, { status: 500 })
  }
}
