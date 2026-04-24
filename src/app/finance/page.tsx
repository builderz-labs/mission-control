async function getContractsData() {
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const thirtyDays = now + 30 * 86400

    const contracts = db.prepare(`
      SELECT
        con.id, con.title, con.contract_number, con.contract_type,
        con.service_type, con.status, con.value, con.billing_cycle,
        con.start_date, con.end_date, con.signed_date,
        c.name as client_name,
        b.name as brand_name
      FROM hm_contracts con
      JOIN hm_clients c ON c.id = con.client_id
      LEFT JOIN hm_brands b ON b.id = con.brand_id
      ORDER BY con.status ASC, con.end_date ASC
    `).all() as Array<Record<string, any>>

    const expiringSoon = contracts.filter(c =>
      c.status === 'active' && c.end_date && c.end_date <= thirtyDays
    )

    return { contracts, expiringSoon }
  } catch {
    return { contracts: [], expiringSoon: [] }
  }
}

function formatDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(val: number | null): string {
  if (val == null) return '—'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact' }).format(val)
}

export default async function FinancePage() {
  const { contracts, expiringSoon } = await getContractsData()

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Finance Hub</h1>
        <p className="text-sm text-neutral-400 mt-1">Kontrak, invoice, dan keuangan</p>
      </div>

      {/* Renewal alerts */}
      {expiringSoon.length > 0 && (
        <div className="mb-6 border border-amber-500/30 rounded-lg bg-amber-500/5 p-4">
          <div className="text-sm font-semibold text-amber-400 mb-2">
            ⚠️ {expiringSoon.length} kontrak jatuh tempo dalam 30 hari:
          </div>
          <ul className="space-y-1">
            {expiringSoon.map(c => (
              <li key={c.id} className="text-sm text-neutral-300 flex items-center gap-2">
                <span className="text-neutral-500">{c.contract_number ?? c.id}</span>
                <span>{c.brand_name ?? c.client_name}</span>
                <span className="text-neutral-500">|</span>
                <span className="text-amber-300">Berakhir {formatDate(c.end_date)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Contracts table */}
      <div className="mb-4 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
        Contracts & KAK — {contracts.length} kontrak
      </div>

      {contracts.length === 0 ? (
        <div className="border border-dashed border-neutral-700 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📄</div>
          <div className="text-neutral-400">Belum ada kontrak. Tambah kontrak melalui API atau integrasikan dengan sistem billing.</div>
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 border-b border-neutral-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">No. Kontrak</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Judul</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Klien / Brand</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Tipe</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Nilai</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Berakhir</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {contracts.map(c => (
                <tr key={c.id} className="hover:bg-neutral-900/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">{c.contract_number ?? `#${c.id}`}</td>
                  <td className="px-4 py-3 text-neutral-200">{c.title}</td>
                  <td className="px-4 py-3 text-neutral-400">
                    {c.brand_name ? <>{c.brand_name} <span className="text-neutral-600">({c.client_name})</span></> : c.client_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 uppercase">
                      {c.contract_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-200">{formatCurrency(c.value)}</td>
                  <td className="px-4 py-3 text-neutral-400">{formatDate(c.end_date)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      c.status === 'active' ? 'bg-green-500/20 text-green-400'
                      : c.status === 'expired' ? 'bg-red-500/20 text-red-400'
                      : 'bg-neutral-700 text-neutral-400'
                    }`}>
                      {c.status}
                    </span>
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
