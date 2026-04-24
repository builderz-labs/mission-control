import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const monthYear = new Date().toISOString().slice(0, 7) // "YYYY-MM"

    const brands = db.prepare(`
      SELECT
        b.id,
        b.name,
        b.slug,
        b.category,
        b.instagram_handle,
        c.name as client_name,
        (
          SELECT COUNT(*) FROM hm_approval_queue aq
          WHERE aq.brand_id = b.id AND aq.month_year = ? AND aq.status = 'pending'
        ) as pending_approval_count,
        (
          SELECT MAX(aq.gate_number) FROM hm_approval_queue aq
          WHERE aq.brand_id = b.id AND aq.month_year = ? AND aq.status = 'pending'
        ) as current_gate,
        (
          SELECT COUNT(*) FROM projects p
          WHERE p.metadata LIKE '%"brand_id":' || b.id || '%' AND p.status = 'active'
        ) as active_project_count
      FROM hm_brands b
      JOIN hm_clients c ON c.id = b.client_id
      WHERE b.status = 'active'
      ORDER BY b.name COLLATE NOCASE ASC
    `).all(monthYear, monthYear) as Array<Record<string, any>>

    // Compute health score per brand (simplified — pulls from hm_brand_kpi)
    const brandsWithHealth: Array<Record<string, any>> = brands.map(brand => {
      const kpis = db.prepare(`
        SELECT status FROM hm_brand_kpi WHERE brand_id = ?
      `).all(brand.id) as Array<{ status: string }>

      const total = kpis.length
      const onTrack = kpis.filter(k => k.status === 'on_track').length
      const needsAttention = kpis.filter(k => k.status === 'needs_attention').length

      // Simplified formula: on_track=1.0, needs_attention=0.6, off_track=0.0
      const kpiScore = total > 0
        ? Math.round(((onTrack + needsAttention * 0.6) / total) * 100)
        : 75 // default when no KPIs set yet

      // Approval queue age score: if any item pending > 2 days, reduce score
      const staleApprovals = db.prepare(`
        SELECT COUNT(*) as cnt FROM hm_approval_queue
        WHERE brand_id = ? AND status = 'pending'
          AND generated_at < (unixepoch() - 172800)
      `).get(brand.id) as { cnt: number }

      const ageScore = staleApprovals.cnt > 0 ? Math.max(0, 100 - staleApprovals.cnt * 15) : 100

      const healthScore = Math.round(
        kpiScore * 0.7 + ageScore * 0.3
      )

      return {
        ...brand,
        health_score: healthScore,
        has_overdue: staleApprovals.cnt > 0,
      }
    })

    // Sort by urgency: overdue+pending first, then low health, then alpha
    brandsWithHealth.sort((a, b) => {
      if (a.has_overdue && !b.has_overdue) return -1
      if (!a.has_overdue && b.has_overdue) return 1
      if (a.pending_approval_count > 0 && b.pending_approval_count === 0) return -1
      if (a.pending_approval_count === 0 && b.pending_approval_count > 0) return 1
      if (a.current_gate !== b.current_gate) return (a.current_gate ?? 99) - (b.current_gate ?? 99)
      if (a.health_score !== b.health_score) return a.health_score - b.health_score
      return a.name.localeCompare(b.name)
    })

    // Daily pulse aggregates
    const totalPending = brandsWithHealth.reduce((s, b) => s + (b.pending_approval_count ?? 0), 0)
    const overdueProjects = brandsWithHealth.filter(b => b.has_overdue).length

    return NextResponse.json({
      brands: brandsWithHealth,
      pulse: {
        pending_approvals: totalPending,
        overdue_projects: overdueProjects,
      },
      month_year: monthYear,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
