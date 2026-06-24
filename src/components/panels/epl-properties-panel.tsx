'use client'

/**
 * EPL Properties Panel — v0.2 real data.
 *
 * Portfolio KPIs + Hot/Star/Cold callouts + heat map.
 * Real numbers come from /api/epl/properties (Atlas export of James's P&L +
 * the canonical registry). Metrics with no real source render as "—".
 * Click tile → drawer fetches /api/epl/properties/[canonical_id].
 */

import { useEffect, useState, useCallback } from 'react'

interface Tile {
  canonical_id: string
  display_name: string
  beds: number | null
  brand: 'EPL' | 'Staylio' | 'NourNest' | 'UrbanReady'
  heat: 'hot' | 'warm' | 'neutral' | 'cool' | 'cold'
  occupancy_30d: number | null
  net_margin_30d: number | null
  guest_score: number | null
  open_tickets: number | null
  status: 'live' | 'onboarding' | 'archived'
}

const HEAT_CLASS: Record<string, string> = {
  hot:     'bg-emerald-600/90 text-white',
  warm:    'bg-emerald-500/20 text-emerald-100',
  neutral: 'bg-secondary text-secondary-foreground',
  cool:    'bg-amber-500/20 text-amber-100',
  cold:    'bg-muted text-foreground border-dashed',
}

const BRAND_CLASS: Record<string, string> = {
  EPL:        'bg-blue-500/20 text-blue-200',
  Staylio:    'bg-purple-500/20 text-purple-200',
  NourNest:   'bg-pink-500/20 text-pink-200',
  UrbanReady: 'bg-amber-500/20 text-amber-200',
}

const dash = (v: number | null | undefined) => (v == null ? '—' : v)

function avg(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null)
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null
}

export function EplPropertiesPanel() {
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [asOf, setAsOf] = useState<Record<string, string> | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<any>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/epl/properties', { cache: 'no-store' }).then(r => r.json())
    setTiles(data.tiles)
    setAsOf(data.as_of ?? null)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!openId) { setDrawer(null); return }
    setDrawer(null)
    fetch(`/api/epl/properties/${openId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j)))
      .then(setDrawer).catch(j => setDrawer({ error: j?.error ?? 'fetch failed' }))
  }, [openId])

  if (!tiles) return <div className="p-8 text-sm text-muted-foreground">Loading properties…</div>

  const live = tiles.filter(t => t.status === 'live')
  const avgOcc = avg(live.map(t => t.occupancy_30d))
  const totalNet = live.reduce((s, t) => s + (t.net_margin_30d ?? 0), 0)
  const avgScore = avg(live.map(t => t.guest_score))
  const ticketsKnown = tiles.map(t => t.open_tickets).filter((v): v is number => v != null)
  const hot = tiles.filter(t => t.heat === 'hot').slice(0, 3)
  const star = tiles
    .filter(t => t.status === 'live' && (t.guest_score ?? 0) >= 4.7)
    .sort((a, b) => (b.guest_score ?? 0) - (a.guest_score ?? 0))
    .slice(0, 3)
  const cold = tiles.filter(t => t.heat === 'cold' || t.heat === 'cool').slice(0, 3)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🏠 Properties</h1>
        <span className="text-muted-foreground">{tiles.length} flats · {live.length} live · {tiles.filter(t => t.status === 'onboarding').length} onboarding</span>
        <button onClick={load} className="ml-auto text-xs underline text-muted-foreground hover:text-foreground">refresh</button>
      </header>

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Avg occupancy 30d" value={avgOcc == null ? '—' : `${Math.round(avgOcc)}%`} />
        <Kpi label="Total net margin 30d" value={`£${(totalNet / 1000).toFixed(1)}k`} />
        <Kpi label="Avg guest score" value={avgScore == null ? '—' : avgScore.toFixed(2)} />
        <Kpi label="Open maintenance" value={ticketsKnown.length ? String(ticketsKnown.reduce((s, v) => s + v, 0)) : '—'} />
      </div>

      {/* Hot / Star / Cold */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout title="🔥 Hot" subtitle="Top performers" tone="emerald" items={hot} onOpen={setOpenId} />
        <Callout title="⭐ Star" subtitle="Highest guest score" tone="amber" items={star} onOpen={setOpenId} />
        <Callout title="🥶 Cold" subtitle="Onboarding or under-performing" tone="slate" items={cold} onOpen={setOpenId} />
      </div>

      {/* Heat map grid */}
      <section>
        <h2 className="text-sm font-medium text-foreground mb-2">Heat map</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map(t => (
            <button key={t.canonical_id} onClick={() => setOpenId(t.canonical_id)} className={`text-left p-4 rounded-2xl border border-border hover:shadow-md hover:border-foreground/20 transition ${HEAT_CLASS[t.heat]}`}>
              <div className="text-sm font-medium truncate">{t.display_name}</div>
              <div className="flex items-center gap-2 mt-1 text-xs opacity-80">
                <span>🛏 {dash(t.beds)}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${BRAND_CLASS[t.brand]}`}>{t.brand}</span>
              </div>
              <div className="flex items-center gap-3 mt-3 text-xs">
                <span>🟢 {t.occupancy_30d == null ? '—' : `${t.occupancy_30d}%`}</span>
                <span>💷 {t.net_margin_30d == null ? '—' : `£${t.net_margin_30d}`}</span>
                <span>⭐ {dash(t.guest_score)}</span>
              </div>
              {t.open_tickets != null && t.open_tickets > 0 && <div className="mt-2 text-xs">🔧 {t.open_tickets}</div>}
            </button>
          ))}
        </div>
      </section>

      <footer className="text-xs text-muted-foreground pt-4 border-t border-border space-y-1">
        <div>Source: <code>/api/epl/properties</code> · Aggregator: registry (BOOM aliases) · James (£ &amp; occ &amp; score) · Hugo (maint — pending)</div>
        {asOf && (
          <div>
            As of: margin <b>{asOf.net_margin_30d}</b> · occupancy <b>{asOf.occupancy_30d}</b> · guest score <b>{asOf.guest_score}</b> · tickets <b>{asOf.open_tickets}</b>
          </div>
        )}
      </footer>

      {openId && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenId(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[560px] bg-card text-card-foreground border-l border-border shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold text-foreground">{openId}</h2>
                <button onClick={() => setOpenId(null)} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
              </div>
              {!drawer && <div className="text-sm text-muted-foreground">Loading property detail…</div>}
              {drawer?.error && <div className="text-rose-400">Error: {drawer.error}</div>}
              {drawer && !drawer.error && (
                <>
                  <div className="text-base font-medium text-foreground">{drawer.display_name}</div>
                  <div className="text-sm text-muted-foreground">{drawer.address}</div>
                  <div className="flex gap-2 flex-wrap text-xs">
                    <span className={`px-2 py-1 rounded-full ${BRAND_CLASS[drawer.brand] ?? 'bg-secondary'}`}>{drawer.brand}</span>
                    <span className="px-2 py-1 rounded-full bg-secondary text-secondary-foreground">🛏 {drawer.beds}</span>
                    <span className="px-2 py-1 rounded-full bg-secondary text-secondary-foreground">🛁 {drawer.baths}</span>
                  </div>
                  <DrawerSection title="🏛 Contract" data={drawer.contract} />
                  <DrawerSection title="📈 Occupancy (PriceLabs)" data={drawer.occupancy} />
                  <DrawerSection title="💰 P&L (James)" data={drawer.pl} />
                  <DrawerSection title="⭐ Guest (Iris)" data={drawer.guest} />
                  <DrawerSection title="🔧 Maintenance (Hugo)" data={drawer.maintenance} />
                  <DrawerSection title="🛡 Compliance (Marcus)" data={drawer.compliance} />
                  {drawer.open_decisions?.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                      <div className="text-xs font-medium text-amber-200">Open decisions</div>
                      {drawer.open_decisions.map((d: any) => (
                        <div key={d.id} className="text-sm mt-1 text-foreground">[{d.id}] {d.title} — {d.age_days}d</div>
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
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

function Callout({ title, subtitle, tone, items, onOpen }: { title: string; subtitle: string; tone: 'emerald' | 'amber' | 'slate'; items: Tile[]; onOpen: (id: string) => void }) {
  const cls = tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/10' : tone === 'amber' ? 'border-amber-500/30 bg-amber-500/10' : 'border-border bg-secondary'
  return (
    <div className={`rounded-2xl border ${cls} p-4`}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
      <div className="mt-3 space-y-1 text-sm text-foreground">
        {items.length === 0 && <div className="text-xs text-muted-foreground italic">none</div>}
        {items.map(t => (
          <button key={t.canonical_id} onClick={() => onOpen(t.canonical_id)} className="block w-full text-left hover:underline">
            {t.display_name} <span className="text-xs text-muted-foreground">· {t.occupancy_30d == null ? '—' : `${t.occupancy_30d}%`} · ⭐{dash(t.guest_score)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function DrawerSection({ title, data }: { title: string; data: any }) {
  if (!data) return null
  return (
    <div className="bg-secondary rounded-xl p-3">
      <div className="text-xs font-medium text-foreground mb-1">{title} <span className="text-muted-foreground">· source: {data.source ?? '—'}</span></div>
      <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify({ ...data, source: undefined }, null, 2)}</pre>
    </div>
  )
}
