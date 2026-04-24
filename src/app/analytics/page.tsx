async function getKpiHubData() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()

    const brands = db.prepare(`
      SELECT
        b.id, b.name,
        n.current_value as nsm_current,
        n.target_value as nsm_target,
        (
          SELECT COUNT(*) FROM hm_brand_kpi k WHERE k.brand_id = b.id AND k.status = 'off_track'
        ) as kpi_off_track,
        (
          SELECT COUNT(*) FROM hm_brand_kpi k WHERE k.brand_id = b.id AND k.status = 'needs_attention'
        ) as kpi_needs_attention,
        (
          SELECT COUNT(*) FROM hm_brand_kpi k WHERE k.brand_id = b.id
        ) as kpi_total
      FROM hm_brands b
      LEFT JOIN hm_brand_nsm n ON n.brand_id = b.id
      WHERE b.status = 'active'
      ORDER BY b.name COLLATE NOCASE ASC
    `).all() as Array<Record<string, any>>

    const enriched: Array<Record<string, any>> = brands.map(b => {
      const total = (b as any).kpi_total ?? 0
      const onTrack = total - (b.kpi_off_track ?? 0) - (b.kpi_needs_attention ?? 0)
      const kpiScore = total > 0
        ? Math.round(((onTrack + (b.kpi_needs_attention ?? 0) * 0.6) / total) * 100)
        : 75
      const nsmPct = b.nsm_target && b.nsm_current != null
        ? Math.min(100, Math.round((b.nsm_current / b.nsm_target) * 100))
        : null
      return { ...b, health_score: kpiScore, nsm_pct: nsmPct }
    })

    const summary = {
      total: enriched.length,
      on_track: enriched.filter(b => b.health_score >= 80).length,
      needs_attention: enriched.filter(b => b.health_score >= 60 && b.health_score < 80).length,
      critical: enriched.filter(b => b.health_score < 60).length,
    }

    return { brands: enriched, summary }
  } catch {
    return { brands: [], summary: { total: 0, on_track: 0, needs_attention: 0, critical: 0 } }
  }
}

function healthIcon(score: number) {
  if (score >= 80) return '✅'
  if (score >= 60) return '🟡'
  return '❌'
}

import Link from 'next/link'

export default async function AnalyticsPage() {
  const { brands, summary } = await getKpiHubData()

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Analytics — KPI Hub</h1>
        <p className="text-sm text-neutral-400 mt-1">Cross-brand KPI performance overview</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-neutral-200">{summary.total}</div>
          <div className="text-sm text-neutral-400 mt-1">Brand Aktif</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">{summary.on_track}</div>
          <div className="text-sm text-neutral-400 mt-1">✅ On Track</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-400">{summary.needs_attention}</div>
          <div className="text-sm text-neutral-400 mt-1">🟡 Perlu Perhatian</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">{summary.critical}</div>
          <div className="text-sm text-neutral-400 mt-1">❌ Kritis</div>
        </div>
      </div>

      {/* Brand table */}
      {brands.length === 0 ? (
        <div className="border border-dashed border-neutral-700 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-neutral-400">Belum ada data KPI. Tambah brand dan konfigurasi KPI terlebih dahulu.</div>
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 border-b border-neutral-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Brand</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">NSM Progress</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Health</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">KPI Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {brands.map(b => (
                <tr key={b.id} className="hover:bg-neutral-900/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-neutral-200">{b.name}</td>
                  <td className="px-4 py-3">
                    {b.nsm_pct != null ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden min-w-[80px]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${b.nsm_pct}%`, backgroundColor: b.nsm_pct >= 80 ? '#22c55e' : b.nsm_pct >= 60 ? '#eab308' : '#ef4444' }}
                          />
                        </div>
                        <span className="text-xs text-neutral-400 w-10 text-right">{b.nsm_pct}%</span>
                      </div>
                    ) : (
                      <span className="text-neutral-600 text-xs">Belum ada</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span style={{ color: b.health_score >= 80 ? '#22c55e' : b.health_score >= 60 ? '#eab308' : '#ef4444' }}>
                      {b.health_score}% {healthIcon(b.health_score)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-400">
                    {b.kpi_total > 0 ? (
                      <>
                        {b.kpi_off_track > 0 && <span className="text-red-400 mr-2">{b.kpi_off_track} KPI ❌</span>}
                        {b.kpi_needs_attention > 0 && <span className="text-yellow-400">{b.kpi_needs_attention} KPI 🟡</span>}
                        {b.kpi_off_track === 0 && b.kpi_needs_attention === 0 && <span className="text-green-400">Semua ✅</span>}
                      </>
                    ) : (
                      <span className="text-neutral-600">Belum dikonfigurasi</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/brands/${b.id}`} className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors">
                      → Session
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
