import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('client_id')

    const brands = db.prepare(`
      SELECT b.*, c.name as client_name
      FROM hm_brands b
      JOIN hm_clients c ON c.id = b.client_id
      ${clientId ? 'WHERE b.client_id = ?' : ''}
      ORDER BY c.name COLLATE NOCASE ASC, b.name COLLATE NOCASE ASC
    `).all(...(clientId ? [clientId] : []))

    return NextResponse.json({ brands })
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
  const clientId = parseInt(body.client_id, 10)
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (isNaN(clientId)) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

  try {
    const db = getDatabase()
    const clientExists = db.prepare('SELECT id FROM hm_clients WHERE id = ?').get(clientId)
    if (!clientExists) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const result = db.prepare(`
      INSERT INTO hm_brands (client_id, name, slug, category, website, instagram_handle, tiktok_handle, monthly_workflow_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId, name, slug,
      body.category ?? null,
      body.website ?? null,
      body.instagram_handle ?? null,
      body.tiktok_handle ?? null,
      body.monthly_workflow_day ?? 1,
    )

    const brand = db.prepare('SELECT * FROM hm_brands WHERE id = ?').get(result.lastInsertRowid)
    return NextResponse.json({ brand }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return NextResponse.json({ error: 'Brand dengan nama ini sudah ada' }, { status: 409 })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
