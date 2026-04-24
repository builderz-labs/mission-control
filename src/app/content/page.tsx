async function getCEPCoverageData() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const monthYear = new Date().toISOString().slice(0, 7)

    const brands = db.prepare(`
      SELECT b.id, b.name FROM hm_brands b WHERE b.status = 'active' ORDER BY b.name
    `).all() as Array<{ id: number; name: string }>

    const coverage = brands.map(brand => {
      const ceps = db.prepare(`
        SELECT id, cep_name, priority FROM hm_brand_cep WHERE brand_id = ? ORDER BY sort_order, id
      `).all(brand.id) as Array<{ id: number; cep_name: string; priority: string }>

      const cepWithStatus = ceps.map(cep => {
        const postCount = db.prepare(`
          SELECT COUNT(*) as cnt FROM hm_social_posts
          WHERE brand_id = ? AND cep_id = ?
            AND (scheduled_date >= ? OR posted_date >= ?)
        `).get(brand.id, cep.id,
          Math.floor(new Date(monthYear + '-01').getTime() / 1000),
          Math.floor(new Date(monthYear + '-01').getTime() / 1000)
        ) as { cnt: number }

        return { ...cep, post_count: postCount.cnt, active: postCount.cnt > 0 }
      })

      return { ...brand, ceps: cepWithStatus }
    })

    return coverage
  } catch {
    return []
  }
}

export default async function ContentPage() {
  const coverage = await getCEPCoverageData()

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Content Hub</h1>
        <p className="text-sm text-neutral-400 mt-1">Semua konten — filter by CEP, channel, status</p>
      </div>

      {/* CEP Coverage Dashboard */}
      {coverage.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
            CEP Coverage Bulan Ini
          </div>
          <div className="border border-neutral-800 rounded-lg bg-neutral-900 p-4 space-y-2">
            {coverage.map(brand => (
              <div key={brand.id} className="flex items-center gap-4 text-sm">
                <span className="text-neutral-300 font-medium w-40 truncate">{brand.name}</span>
                <div className="flex gap-2 flex-wrap">
                  {brand.ceps.length === 0 ? (
                    <span className="text-neutral-600 text-xs">Belum ada CEP</span>
                  ) : (
                    brand.ceps.map(cep => (
                      <span
                        key={cep.id}
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          cep.active
                            ? 'border-green-500/40 bg-green-500/10 text-green-400'
                            : 'border-red-500/30 bg-red-500/5 text-red-400'
                        }`}
                      >
                        {cep.cep_name} {cep.active ? '✅' : '❌'}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kanban placeholder */}
      <div className="border border-dashed border-neutral-700 rounded-lg p-12 text-center">
        <div className="text-4xl mb-3">📝</div>
        <div className="text-neutral-400 font-medium">Kanban Konten</div>
        <div className="text-sm text-neutral-600 mt-1">
          Kanban view dengan filter CEP akan diintegrasikan dari hm_social_posts di Fase G.
        </div>
      </div>
    </div>
  )
}
