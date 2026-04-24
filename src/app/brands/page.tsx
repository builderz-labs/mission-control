import Link from 'next/link'
import { GlobalProjectBoard } from '@/components/jk/global-project-board'

async function getBrandsData() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const monthYear = new Date().toISOString().slice(0, 7)

    const brands = db.prepare(`
      SELECT
        b.id, b.name, b.slug, b.category, b.status,
        c.name as client_name,
        (
          SELECT COUNT(*) FROM hm_approval_queue aq
          WHERE aq.brand_id = b.id AND aq.month_year = ? AND aq.status = 'pending'
        ) as pending_count
      FROM hm_brands b
      JOIN hm_clients c ON c.id = b.client_id
      ORDER BY c.name COLLATE NOCASE ASC, b.name COLLATE NOCASE ASC
    `).all(monthYear) as Array<Record<string, any>>

    return brands
  } catch {
    return []
  }
}

export default async function BrandsPage() {
  const brands = await getBrandsData()

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Brands & Projects</h1>
          <p className="text-sm text-neutral-400 mt-1">Semua brand lintas klien — {brands.length} brand</p>
        </div>
      </div>

      {brands.length === 0 ? (
        <div className="border border-dashed border-neutral-700 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-neutral-400 font-medium">Belum ada brand</div>
          <div className="text-sm text-neutral-600 mt-1">Tambah klien dan brand terlebih dahulu.</div>
        </div>
      ) : (
        <div className="overflow-hidden border border-neutral-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 border-b border-neutral-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Brand</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Klien</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Kategori</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Approval</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {brands.map(brand => (
                <tr key={brand.id} className="hover:bg-neutral-900/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-neutral-200">{brand.name}</td>
                  <td className="px-4 py-3 text-neutral-400">{brand.client_name}</td>
                  <td className="px-4 py-3 text-neutral-500">{brand.category ?? '—'}</td>
                  <td className="px-4 py-3">
                    {brand.pending_count > 0 ? (
                      <span className="text-amber-400">⏳ {brand.pending_count} pending</span>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      brand.status === 'active'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-neutral-700 text-neutral-400'
                    }`}>
                      {brand.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/brands/${brand.id}`}
                      className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors"
                    >
                      → Session
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GlobalProjectBoard />
    </div>
  )
}
