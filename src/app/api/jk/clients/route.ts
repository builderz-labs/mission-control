import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const clients = db.prepare(`
      SELECT c.*, COUNT(b.id) as brand_count
      FROM hm_clients c
      LEFT JOIN hm_brands b ON b.client_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE ASC
    `).all()
    return NextResponse.json({ clients })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, any>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

  try {
    const db = getDatabase()
    const result = db.prepare(`
      INSERT INTO hm_clients (name, slug, contact_name, contact_email, contact_phone, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(name, slug, body.contact_name ?? null, body.contact_email ?? null, body.contact_phone ?? null, body.notes ?? null)

    const client = db.prepare('SELECT * FROM hm_clients WHERE id = ?').get(result.lastInsertRowid)
    return NextResponse.json({ client }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return NextResponse.json({ error: 'Client dengan nama ini sudah ada' }, { status: 409 })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
