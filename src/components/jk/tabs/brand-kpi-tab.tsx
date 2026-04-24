'use client'

import { useState } from 'react'

interface NSM {
  id: number
  nsm_name: string
  nsm_description: string | null
  target_value: number | null
  current_value: number | null
  trend_vs_last_period: number | null
}

interface KPI {
  id: number
  service_type: string
  kpi_name: string
  kpi_category: string
  target_value: number | null
  target_operator: string
  target_unit: string | null
  current_value: number | null
  status: 'on_track' | 'needs_attention' | 'off_track'
}

interface Props {
  nsm: NSM | null
  kpis: KPI[]
}

const STATUS_ICON: Record<string, string> = {
  on_track: '✅',
  needs_attention: '🟡',
  off_track: '❌',
}

const SERVICE_LABELS: Record<string, string> = {
  seo: 'SEO',
  social: 'Social Media',
  ads: 'Ads',
  website: 'Website',
  brand: 'Brand',
}

export function BrandKpiTab({ nsm, kpis }: Props) {
  const [subTab, setSubTab] = useState<'nsm' | 'strategy'>('nsm')

  const grouped = kpis.reduce<Record<string, KPI[]>>((acc, k) => {
    if (!acc[k.service_type]) acc[k.service_type] = []
    acc[k.service_type].push(k)
    return acc
  }, {})

  const nsmPct = nsm?.target_value && nsm.current_value != null
    ? Math.min(100, Math.round((nsm.current_value / nsm.target_value) * 100))
    : null

  return (
    <div className="space-y-6">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 border-b border-neutral-800 pb-0">
        {(['nsm', 'strategy'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 text-sm rounded-t transition-colors ${
              subTab === t
                ? 'bg-neutral-800 text-neutral-100 border-b-2 border-blue-500'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t === 'nsm' ? 'NSM & KPI' : 'Strategi Brand'}
          </button>
        ))}
      </div>

      {subTab === 'nsm' && (
        <div className="space-y-6">
          {/* North Star Metric */}
          {nsm ? (
            <div className="border border-neutral-700 rounded-lg bg-neutral-900 p-4">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">North Star Metric</div>
              <div className="text-base font-medium text-neutral-200 mb-3">"{nsm.nsm_name}"</div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-neutral-400">Target: <span className="text-neutral-200 font-semibold">{nsm.target_value ?? '—'}</span></span>
                <span className="text-neutral-400">Aktual: <span className="text-neutral-200 font-semibold">{nsm.current_value ?? '—'}</span></span>
                {nsm.trend_vs_last_period != null && (
                  <span className={nsm.trend_vs_last_period >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {nsm.trend_vs_last_period >= 0 ? '↑' : '↓'} {Math.abs(nsm.trend_vs_last_period)}%
                  </span>
                )}
              </div>
              {nsmPct !== null && (
                <div>
                  <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${nsmPct}%`,
                        backgroundColor: nsmPct >= 80 ? '#22c55e' : nsmPct >= 60 ? '#eab308' : '#ef4444',
                      }}
                    />
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">{nsmPct}% dari target</div>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-sm text-neutral-500">
              Belum ada NSM yang dikonfigurasi untuk brand ini.
            </div>
          )}

          {/* KPI per service */}
          {Object.keys(grouped).length === 0 ? (
            <div className="border border-dashed border-neutral-700 rounded-lg p-6 text-center text-sm text-neutral-500">
              Belum ada KPI yang dikonfigurasi.
            </div>
          ) : (
            Object.entries(grouped).map(([svc, items]) => (
              <div key={svc}>
                <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                  [{SERVICE_LABELS[svc] ?? svc}]
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500 border-b border-neutral-800">
                      <th className="text-left pb-2">KPI</th>
                      <th className="text-right pb-2">Target</th>
                      <th className="text-right pb-2">Aktual</th>
                      <th className="text-right pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {items.map(kpi => (
                      <tr key={kpi.id}>
                        <td className="py-2 text-neutral-300">{kpi.kpi_name}</td>
                        <td className="py-2 text-right text-neutral-400">
                          {kpi.target_operator === 'gte' ? '≥' : kpi.target_operator === 'lte' ? '≤' : '='}{kpi.target_value ?? '—'}{kpi.target_unit ?? ''}
                        </td>
                        <td className="py-2 text-right text-neutral-200 font-medium">
                          {kpi.current_value ?? '—'}{kpi.target_unit ?? ''}
                        </td>
                        <td className="py-2 text-right">{STATUS_ICON[kpi.status] ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'strategy' && (
        <div className="border border-dashed border-neutral-700 rounded-lg p-8 text-center text-neutral-500">
          <div className="text-2xl mb-2">🗺️</div>
          <div className="font-medium text-neutral-400">BMC + VPC + CEP</div>
          <div className="text-sm mt-1">Editor strategi brand akan tersedia di Fase C lanjutan.</div>
        </div>
      )}
    </div>
  )
}
