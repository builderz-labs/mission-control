import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runMonthlyWorkflow } from '@/lib/jk/jk-monthly-workflow'

/**
 * POST /api/jk/workflow
 * Manually trigger the JK monthly workflow (creates Gate 1 items for all active brands).
 * Can optionally specify a month_year override (default: current month).
 *
 * Normally called by a cron on the 1st of each month.
 * Requires operator+ role.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let monthYear: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    if (body.month_year && /^\d{4}-\d{2}$/.test(body.month_year)) {
      monthYear = body.month_year
    }
  } catch { /* use default */ }

  const result = runMonthlyWorkflow(monthYear)
  return NextResponse.json(result)
}

/**
 * GET /api/jk/workflow
 * Returns workflow status for the current month — which brands have Gate 1 and which don't.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { getDatabase } = await import('@/lib/db')
  const db = getDatabase()
  const monthYear = new Date().toISOString().slice(0, 7)

  const brands = db.prepare(`
    SELECT b.id, b.name, b.category, c.name as client_name
    FROM hm_brands b
    JOIN hm_clients c ON c.id = b.client_id
    WHERE b.status = 'active'
    ORDER BY c.name, b.name
  `).all() as Array<{ id: number; name: string; category: string; client_name: string }>

  const gate1Map = new Map<number, Record<string, any>>()
  const gate1Rows = db.prepare(`
    SELECT brand_id, status, created_at
    FROM hm_approval_queue
    WHERE month_year = ? AND gate_number = 1 AND status != 'superseded'
    ORDER BY id DESC
  `).all(monthYear) as Array<{ brand_id: number; status: string; created_at: number }>
  for (const row of gate1Rows) {
    if (!gate1Map.has(row.brand_id)) gate1Map.set(row.brand_id, row)
  }

  const status = brands.map(b => ({
    ...b,
    gate1_status: gate1Map.get(b.id)?.status ?? null,
    gate1_created_at: gate1Map.get(b.id)?.created_at ?? null,
  }))

  const pending = status.filter(s => s.gate1_status === 'pending').length
  const approved = status.filter(s => s.gate1_status === 'approved' || s.gate1_status === 'adjusted').length
  const missing = status.filter(s => !s.gate1_status).length

  return NextResponse.json({
    month_year: monthYear,
    summary: { total: brands.length, pending, approved, missing },
    brands: status,
  })
}
