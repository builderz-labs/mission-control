'use client'

/**
 * EPL Properties Panel — v0.1 real React.
 *
 * Portfolio KPIs + Hot/Star/Cold callouts + 16-tile heat map.
 * Click tile → drawer fetches /api/epl/properties/[canonical_id].
 */

import { useEffect, useState, useCallback } from 'react'

interface Tile {
  canonical_id: string
  display_name: string
  beds: number
  brand: 'EPL' | 'Staylio' | 'NourNest' | 'UrbanReady'
  heat: 'hot' | 'warm' | 'neutral' | 'cool' | 'cold'
  occupancy_30d: number
  net_margin_30d: number
  guest_score: number
  open_tickets: number
  status: 'live' | 'onboarding' | 'archived'
}

const HEAT_CLASS: Record<string, string> = {
  hot:     'bg-emerald-600 text-white',
  warm:    'bg-emerald-200 text-emerald-900',
  neutral: 'bg-slate-200 text-slate-800',
  cool:    'bg-amber-200 text-amber-900',
  cold:    'bg-slate-100 text-slate-600 border-dashed',
}

const BRAND_CLASS: Record<string, string> = {
  EPL:        'bg-blue-100 text-blue-800',
  Staylio:    'bg-purple-100 text-purple-800',
  NourNest:   'bg-pink-100 text-pink-800',
  UrbanReady: 'bg-amber-100 text-amber-800',
}

export function EplPropertiesPanel() {
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<any>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/epl/properties', { cache: 'no-store' }).then(r => r.json())
    setTiles(data.tiles)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!openId) { setDrawer(null); return }
    setDrawer(null)
    fetch(`/api/epl/properties/${openId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j)))
      .then(setDrawer).catch(j => setDrawer({ error: j?.error ?? 'fetch failed' }))
  }, [openId])

  if (!tiles) return <div className="p-8 text-sm text-slate-500">Loading properties…</div>

  const live = tiles.filter(t => t.status === 'live')
  const avgOcc = live.length ? Math.round(live.reduce((s, t) => s + t.occupancy_30d, 0) / live.length) : 0
  const totalNet = live.reduce((s, t) => s + t.net_margin_30d, 0)
  const avgScore = live.length ? (live.reduce((s, t) => s + t.guest_score, 0) / live.length).toFixed(2) : '—'
  const hot = tiles.filter(t => t.heat === 'hot').slice(0, 3)
  const star = tiles.filter(t => t.guest_score >= 4.7 && t.status === 'live').slice(0, 3)
  const cold = tiles.filter(t => t.heat === 'cold' || t.heat === 'cool').slice(0, 3)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🏠 Properties</h1>
        <span className="text-slate-500">{tiles.length} flats · {live.length} live · {tiles.filter(t => t.status === 'onboarding').length} onboarding</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Avg occupancy 30d" value={`${avgOcc}%`} />
        <Kpi label="Total net margin 30d" value={`£${(totalNet / 1000).toFixed(1)}k`} />
        <Kpi label="Avg guest score" value={String(avgScore)} />
        <Kpi label="Open maintenance" value={String(tiles.reduce((s, t) => s + t.open_tickets, 0))} />
      </div>

      {/* Hot / Star / Cold */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout title="🔥 Hot" subtitle="Top performers" tone="emerald" items={hot} onOpen={setOpenId} />
        <Callout title="⭐ Star" subtitle="Highest guest score" tone="amber" items={star} onOpen={setOpenId} />
        <Callout title="🥶 Cold" subtitle="Onboarding or under-performing" tone="slate" items={cold} onOpen={setOpenId} />
      </div>

      {/* Heat map grid */}
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Heat map</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map(t => (
            <button key={t.canonical_id} onClick={() => setOpenId(t.canonical_id)} className={`text-left p-4 rounded-2xl border border-slate-200 hover:shadow-md transition ${HEAT_CLASS[t.heat]}`}>
              <div className="text-sm font-medium truncate">{t.display_name}</div>
              <div className="flex items-center gap-2 mt-1 text-xs opacity-80">
                <span>🛏 {t.beds}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${BRAND_CLASS[t.brand]}`}>{t.brand}</span>
              </div>
              <div className="flex items-center gap-3 mt-3 text-xs">
                <span>🟢 {t.occupancy_30d}%</span>
                <span>💷 £{t.net_margin_30d}</span>
                <span>⭐ {t.guest_score || '—'}</span>
              </div>
              {t.open_tickets > 0 && <div className="mt-2 text-xs">🔧 {t.open_tickets}</div>}
            </button>
          ))}
        </div>
      </section>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/properties</code> · drawer <code>/api/epl/properties/[canonical_id]</code> · Aggregator: BOOM (registry) · PriceLabs (occ) · James (£) · Iris (score) · Hugo (maint)
      </footer>

      {openId && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenId(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[560px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">{openId}</h2>
                <button onClick={() => setOpenId(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>
              {!drawer && <div className="text-sm text-slate-500">Loading property detail…</div>}
              {drawer?.error && <div className="text-rose-700">Error: {drawer.error}</div>}
              {drawer && !drawer.error && (
                <>
                  <div className="text-base font-medium">{drawer.display_name}</div>
                  <div className="text-sm text-slate-600">{drawer.address}</div>
                  <div className="flex gap-2 flex-wrap text-xs">
                    <span className={`px-2 py-1 rounded-full ${BRAND_CLASS[drawer.brand] ?? 'bg-slate-100'}`}>{drawer.brand}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100">🛏 {drawer.beds}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100">🛁 {drawer.baths}</span>
                  </div>
                  <DrawerSection title="🏛 Contract" data={drawer.contract} />
                  <DrawerSection title="📈 Occupancy (PriceLabs)" data={drawer.occupancy} />
                  <DrawerSection title="💰 P&L (James)" data={drawer.pl} />
                  <DrawerSection title="⭐ Guest (Iris)" data={drawer.guest} />
                  <DrawerSection title="🔧 Maintenance (Hugo)" data={drawer.maintenance} />
                  <DrawerSection title="🛡 Compliance (Marcus)" data={drawer.compliance} />
                  {drawer.open_decisions?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <div className="text-xs font-medium text-amber-900">Open decisions</div>
                      {drawer.open_decisions.map((d: any) => (
                        <div key={d.id} className="text-sm mt-1">[{d.id}] {d.title} — {d.age_days}d</div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function Callout({ title, subtitle, tone, items, onOpen }: { title: string; subtitle: string; tone: 'emerald' | 'amber' | 'slate'; items: Tile[]; onOpen: (id: string) => void }) {
  const cls = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
  return (
    <div className={`rounded-2xl border ${cls} p-4`}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-slate-500">{subtitle}</div>
      <div className="mt-3 space-y-1 text-sm">
        {items.length === 0 && <div className="text-xs text-slate-400 italic">none</div>}
        {items.map(t => (
          <button key={t.canonical_id} onClick={() => onOpen(t.canonical_id)} className="block w-full text-left hover:underline">
            {t.display_name} <span className="text-xs text-slate-500">· {t.occupancy_30d}% · ⭐{t.guest_score || '—'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function DrawerSection({ title, data }: { title: string; data: any }) {
  if (!data) return null
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <div className="text-xs font-medium text-slate-700 mb-1">{title} <span className="text-slate-400">· source: {data.source ?? '—'}</span></div>
      <pre className="text-xs text-slate-600 whitespace-pre-wrap">{JSON.stringify({ ...data, source: undefined }, null, 2)}</pre>
    </div>
  )
}
