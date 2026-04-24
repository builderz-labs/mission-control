import { BrandCard } from '@/components/jk/brand-card'
import { DailyPulse } from '@/components/jk/daily-pulse'
import { WorkflowTrigger } from '@/components/jk/workflow-trigger'

async function getWorkflowStatus() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const monthYear = new Date().toISOString().slice(0, 7)
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM hm_brands WHERE status = 'active'`).get() as { cnt: number }).cnt
    const gate1Rows = db.prepare(`
      SELECT brand_id, status FROM hm_approval_queue
      WHERE month_year = ? AND gate_number = 1 AND status != 'superseded'
    `).all(monthYear) as Array<{ brand_id: number; status: string }>
    const pending = gate1Rows.filter(r => r.status === 'pending').length
    const approved = gate1Rows.filter(r => r.status === 'approved' || r.status === 'adjusted').length
    const missing = total - gate1Rows.length
    return { month_year: monthYear, summary: { total, pending, approved, missing } }
  } catch {
    return null
  }
}

async function getPortfolioData() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const { getGatePipeline } = await import('@/lib/jk/approval-queue')
    const db = getDatabase()
    const monthYear = new Date().toISOString().slice(0, 7)

    const brands = db.prepare(`
      SELECT
        b.id, b.name, b.slug, b.category,
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
          WHERE json_extract(p.metadata, '$.brand_id') = b.id AND p.status = 'active'
        ) as active_project_count
      FROM hm_brands b
      JOIN hm_clients c ON c.id = b.client_id
      WHERE b.status = 'active'
      ORDER BY b.name COLLATE NOCASE ASC
    `).all(monthYear, monthYear) as Array<Record<string, any>>

    const brandsWithHealth: Array<Record<string, any>> = brands.map(brand => {
      const kpis = db.prepare(`SELECT status FROM hm_brand_kpi WHERE brand_id = ?`).all(brand.id) as Array<{ status: string }>
      const total = kpis.length
      const onTrack = kpis.filter(k => k.status === 'on_track').length
      const needsAttn = kpis.filter(k => k.status === 'needs_attention').length
      const kpiScore = total > 0 ? Math.round(((onTrack + needsAttn * 0.6) / total) * 100) : 75

      const stale = db.prepare(`
        SELECT COUNT(*) as cnt FROM hm_approval_queue
        WHERE brand_id = ? AND status = 'pending' AND generated_at < (unixepoch() - 172800)
      `).get(brand.id) as { cnt: number }

      const ageScore = stale.cnt > 0 ? Math.max(0, 100 - stale.cnt * 15) : 100
      const healthScore = Math.round(kpiScore * 0.7 + ageScore * 0.3)

      return { ...brand, health_score: healthScore, has_overdue: stale.cnt > 0 }
    })

    brandsWithHealth.sort((a, b) => {
      if (a.has_overdue && !b.has_overdue) return -1
      if (!a.has_overdue && b.has_overdue) return 1
      if (a.pending_approval_count > 0 && b.pending_approval_count === 0) return -1
      if (a.pending_approval_count === 0 && b.pending_approval_count > 0) return 1
      if (a.health_score !== b.health_score) return a.health_score - b.health_score
      return a.name.localeCompare(b.name)
    })

    const totalPending = brandsWithHealth.reduce((s, b) => s + (b.pending_approval_count ?? 0), 0)
    const overdueCount = brandsWithHealth.filter(b => b.has_overdue).length

    return { brands: brandsWithHealth, pulse: { pending_approvals: totalPending, overdue_projects: overdueCount } }
  } catch {
    return { brands: [], pulse: { pending_approvals: 0, overdue_projects: 0 } }
  }
}

export default async function PortfolioPage() {
  const [{ brands, pulse }, workflowStatus] = await Promise.all([getPortfolioData(), getWorkflowStatus()])

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-100">Portfolio Board</h1>
        <p className="text-sm text-neutral-400 mt-1">Command center — scan cepat semua brand</p>
      </div>

      {/* Zona A — Daily Pulse */}
      <div className="mb-8">
        <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Daily Pulse</div>
        <DailyPulse pulse={pulse} />
      </div>

      {/* Zona B — Brand Grid */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
          Brand Portfolio — {brands.length} brand aktif
        </div>
        <WorkflowTrigger initialStatus={workflowStatus} />
      </div>

      {brands.length === 0 ? (
        <div className="border border-dashed border-neutral-700 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-neutral-400 font-medium">Belum ada brand</div>
          <div className="text-sm text-neutral-600 mt-1">Tambah klien dan brand melalui halaman Brands</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {brands.map(brand => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}
    </div>
  )
}
