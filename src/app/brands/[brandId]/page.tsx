import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BrandWorkSession } from '@/components/jk/brand-work-session'

async function getBrandData(brandId: number) {
  const { getDatabase } = await import('@/lib/db')
  const { getGatePipeline, getPendingQueue } = await import('@/lib/jk/approval-queue')
  const db = getDatabase()
  const monthYear = new Date().toISOString().slice(0, 7)

  const brand = db.prepare(`
    SELECT b.id, b.name, b.slug, b.category, b.website, b.instagram_handle, b.tiktok_handle,
           c.id as client_id, c.name as client_name
    FROM hm_brands b
    JOIN hm_clients c ON c.id = b.client_id
    WHERE b.id = ? AND b.status = 'active'
  `).get(brandId) as Record<string, any> | undefined

  if (!brand) return null

  const queue = getPendingQueue(brandId, monthYear)
  const gates = getGatePipeline(brandId, monthYear)

  // Enrich queue items with brand name
  const enrichedQueue = queue.map(item => ({ ...item, brand_name: brand.name }))

  const nsm = db.prepare(`SELECT * FROM hm_brand_nsm WHERE brand_id = ?`).get(brandId) ?? null
  const kpis = db.prepare(`SELECT * FROM hm_brand_kpi WHERE brand_id = ? ORDER BY service_type, id`).all(brandId)

  // Health score
  const kpiRows = kpis as Array<{ status: string }>
  const total = kpiRows.length
  const onTrack = kpiRows.filter(k => k.status === 'on_track').length
  const needsAttn = kpiRows.filter(k => k.status === 'needs_attention').length
  const kpiScore = total > 0 ? Math.round(((onTrack + needsAttn * 0.6) / total) * 100) : 75
  const healthScore = kpiScore

  const enrichedBrand: Record<string, any> = { ...brand, health_score: healthScore }
  return {
    brand: enrichedBrand,
    queue: enrichedQueue,
    gates,
    nsm,
    kpis,
    monthYear,
    pendingCount: queue.length,
  }
}

export default async function BrandWorkSessionPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const id = parseInt(brandId, 10)
  if (isNaN(id)) notFound()

  const data = await getBrandData(id)
  if (!data) notFound()

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Breadcrumb */}
      <div className="px-6 pt-4 pb-2 text-xs text-neutral-500 flex items-center gap-1.5">
        <Link href="/portfolio" className="hover:text-neutral-300">Portfolio</Link>
        <span>›</span>
        <span className="text-neutral-400">{data.brand.client_name}</span>
        <span>›</span>
        <span className="text-neutral-200">{data.brand.name}</span>
      </div>

      {/* Brand header */}
      <div className="px-6 pb-4 border-b border-neutral-800">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100">{data.brand.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-neutral-400">
              {data.brand.category && <span>{data.brand.category}</span>}
              {data.brand.website && <span>{data.brand.website}</span>}
              {data.brand.instagram_handle && <span>@{data.brand.instagram_handle}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-neutral-400 mb-1">Health Score</div>
            <div
              className="text-2xl font-bold"
              style={{ color: data.brand.health_score >= 80 ? '#22c55e' : data.brand.health_score >= 60 ? '#eab308' : '#ef4444' }}
            >
              {data.brand.health_score}%
            </div>
          </div>
        </div>
      </div>

      {/* Main content with tabs */}
      <BrandWorkSession
        brand={data.brand}
        initialQueue={data.queue}
        initialGates={data.gates}
        nsm={data.nsm as any}
        kpis={data.kpis as any}
        monthYear={data.monthYear}
        pendingCount={data.pendingCount}
      />
    </div>
  )
}
