import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGatePipeline, getPendingQueue } from '@/lib/jk/approval-queue'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const brandId = parseInt(id, 10)
  if (isNaN(brandId)) return NextResponse.json({ error: 'Invalid brand id' }, { status: 400 })

  const monthYear = new URL(request.url).searchParams.get('month') ?? new Date().toISOString().slice(0, 7)

  try {
    const db = getDatabase()
    const brand = db.prepare('SELECT id, name FROM hm_brands WHERE id = ?').get(brandId)
    if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

    const queue = getPendingQueue(brandId, monthYear)
    const gates = getGatePipeline(brandId, monthYear)

    // Enrich queue items with brand_name
    const enriched = queue.map(item => ({ ...item, brand_name: (brand as any).name }))

    return NextResponse.json({ queue: enriched, gates, month_year: monthYear })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
