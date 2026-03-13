import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCCDatabaseWrite, getCCDatabase } from '@/lib/cc-db'
import { randomUUID } from 'node:crypto'

/**
 * POST /api/feed/digest — Store a structured digest from Worm
 * Body: { label, items: [{ summary, tweet_url, tweet_id, theme, author }], stats }
 */
export async function POST(req: NextRequest) {
  const auth = requireRole(req, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { label, items, stats } = body

  if (!label || !items || !Array.isArray(items)) {
    return NextResponse.json({ error: 'label and items[] required' }, { status: 400 })
  }

  const db = getCCDatabaseWrite()
  try {
    const id = randomUUID()
    const now = new Date().toISOString()

    // Create the digests table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        items TEXT NOT NULL,
        stats TEXT,
        created_at TEXT NOT NULL
      )
    `)

    db.prepare(
      'INSERT INTO digests (id, label, items, stats, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, label, JSON.stringify(items), JSON.stringify(stats || {}), now)

    return NextResponse.json({ id, label, itemCount: items.length }, { status: 201 })
  } finally {
    db.close()
  }
}

/**
 * GET /api/feed/digest — List recent digests
 * Query: ?limit=10
 */
export async function GET(req: NextRequest) {
  const auth = requireRole(req, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '10')

  const db = getCCDatabase()

  // Table might not exist yet
  try {
    const digests = db.prepare(
      'SELECT * FROM digests ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[]

    return NextResponse.json({
      digests: digests.map(d => ({
        ...d,
        items: JSON.parse(d.items),
        stats: d.stats ? JSON.parse(d.stats) : null,
      }))
    })
  } catch {
    return NextResponse.json({ digests: [] })
  }
}
