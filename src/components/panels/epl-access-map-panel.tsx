'use client'

/**
 * EPL Setups / Access Map Panel.
 *
 * Surfaces the canonical Team Access Map (Atlas-owned) inside Mission Control:
 * 24 tool/account setups, the role onboarding bundles, and the 1Password vault
 * plan. Fetches /api/epl/access-map (live from the mounted Atlas CSV). Sister
 * to Start Here (agent→API integrations); this one is the human/ops setups map
 * used to onboard a joiner from one checklist.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AccessTool {
  tool: string
  category: string
  entity: string
  owner: string
  multiUser: string
  whereLoginLives: string
  vaultTarget: string
  roles: string[]
  confirm: boolean
  notes: string
}
interface AccessRoleBundle { role: string; vaults: string[]; seats: string[] }
interface AccessVault { vault: string; status: string; holds: string[]; grantTo: string[]; note: string }
interface AccessMapData {
  generatedAt: string
  source: 'atlas-csv' | 'unavailable'
  dir: string
  updatedAt: string | null
  counts: { tools: number; roles: number; vaults: number }
  tools: AccessTool[]
  roles: AccessRoleBundle[]
  vaults: AccessVault[]
  error?: string
}

const CAT_CLASS: Record<string, string> = {
  'PMS / guest ops': 'bg-amber-100 text-amber-800',
  OTA: 'bg-blue-100 text-blue-800',
  Payments: 'bg-emerald-100 text-emerald-800',
  Banking: 'bg-emerald-100 text-emerald-800',
  Accounting: 'bg-teal-100 text-teal-800',
  Comms: 'bg-violet-100 text-violet-800',
  'Comms / infra': 'bg-violet-100 text-violet-800',
  CRM: 'bg-pink-100 text-pink-800',
  Design: 'bg-rose-100 text-rose-800',
  Pricing: 'bg-cyan-100 text-cyan-800',
  Infra: 'bg-slate-200 text-slate-800',
  'Web / infra': 'bg-indigo-100 text-indigo-800',
  'Code / infra': 'bg-slate-200 text-slate-800',
  Dashboard: 'bg-purple-100 text-purple-800',
}
function catClass(c: string): string {
  return CAT_CLASS[c] ?? 'bg-slate-100 text-slate-700'
}

export function EplAccessMapPanel() {
  const [data, setData] = useState<AccessMapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState<string>('all')
  const [showOnboard, setShowOnboard] = useState(false)
  const [showVaults, setShowVaults] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/access-map', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.tools.map((t) => t.category))).sort()
  }, [data])
  const visibleTools = useMemo(() => {
    if (!data) return []
    return cat === 'all' ? data.tools : data.tools.filter((t) => t.category === cat)
  }, [data, cat])

  if (error) return <div className="p-8 text-rose-700">Failed: {error}</div>
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading access map…</div>

  const confirmCount = data.tools.filter((t) => t.confirm).length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight">🔑 Setups / Access</h1>
          <span className="text-slate-500 text-sm">
            {data.counts.tools} tools · {data.counts.roles} roles · {data.counts.vaults} vaults
            {confirmCount > 0 ? ` · ${confirmCount} to confirm` : ''}
          </span>
          <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
        </div>
        <p className="text-slate-700 text-sm leading-relaxed">
          The canonical team setups list — every tool/account, who owns it, where the login lives, and which roles need it.
          Onboard a joiner from one checklist: pick a role → grant its 1Password vault(s) + seats.
        </p>
        {/* Honest source banner */}
        <div
          className={`text-xs rounded-xl border px-3 py-2 ${
            data.source === 'unavailable'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {data.source === 'unavailable'
            ? `⚠ Access map CSV not reachable (${data.dir}). Atlas regenerates it from access_map.yaml — confirm the data mount.`
            : `Live from Atlas CSV (${data.dir}) · map last updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString('en-GB') : 'unknown'}.`}
        </div>
      </header>

      {/* Onboarding quick-start */}
      {data.roles.length > 0 && (
        <section>
          <button
            onClick={() => setShowOnboard((v) => !v)}
            className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-4 hover:bg-emerald-100 transition"
          >
            <span className="font-medium text-emerald-900">📥 Onboarding quick-start — grant a joiner everything from one list</span>
            <span className="text-emerald-700">{showOnboard ? '−' : '+'}</span>
          </button>
          {showOnboard && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.roles.map((r) => (
                <div key={r.role} className="bg-white rounded-xl border border-slate-200 p-3">
                  <div className="font-medium text-slate-900 text-sm">{r.role}</div>
                  <div className="text-xs text-slate-600 mt-1">
                    <span className="text-slate-400">Vaults:</span> {r.vaults.join(', ') || '—'}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    <span className="text-slate-400">Seats:</span> {r.seats.join(', ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 1Password vault plan */}
      {data.vaults.length > 0 && (
        <section>
          <button
            onClick={() => setShowVaults((v) => !v)}
            className="w-full flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl p-4 hover:bg-violet-100 transition"
          >
            <span className="font-medium text-violet-900">🔐 1Password vault plan — a vault = a role&apos;s access bundle</span>
            <span className="text-violet-700">{showVaults ? '−' : '+'}</span>
          </button>
          {showVaults && (
            <div className="mt-3 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Vault</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Holds</th>
                    <th className="text-left px-4 py-2 font-medium">Grant to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.vaults.map((v) => (
                    <tr key={v.vault} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{v.vault}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${v.status === 'existing' || v.status === 'exists' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{v.status}</span></td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{v.holds.join(', ')}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{v.grantTo.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCat('all')}
          className={`px-3 py-1 rounded-full text-xs border ${cat === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
        >
          all ({data.tools.length})
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1 rounded-full text-xs border ${cat === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Tools table */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Tool</th>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Owner</th>
              <th className="text-left px-4 py-2 font-medium">Where login lives</th>
              <th className="text-left px-4 py-2 font-medium">Vault</th>
              <th className="text-left px-4 py-2 font-medium">Roles</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleTools.map((t) => (
              <tr key={t.tool} className={`hover:bg-slate-50 align-top ${t.confirm ? 'bg-amber-50/40' : ''}`}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {t.tool}
                  {t.confirm && <span title="gap to confirm" className="ml-1">🟡</span>}
                  {t.notes && <div className="text-xs text-slate-400 font-normal mt-1 max-w-md">{t.notes}</div>}
                </td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${catClass(t.category)}`}>{t.category}</span></td>
                <td className="px-4 py-3 text-slate-600 text-xs">{t.owner}</td>
                <td className="px-4 py-3 text-slate-600 text-xs max-w-[14rem]">{t.whereLoginLives}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{t.vaultTarget}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap max-w-xs">
                    {t.roles.map((r) => (
                      <span key={r} className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">{r}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/access-map</code> ← Atlas <code>access_map_csv/</code> · no passwords here, logins live in 1Password.
      </footer>
    </div>
  )
}
