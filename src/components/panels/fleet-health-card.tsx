'use client'

/**
 * FleetHealthCard — VPS / fleet health "all in one go" on Mission Control,
 * a sibling to Properties and Agents.
 *
 * Reads /api/epl/health (which loads /atlas-data/fleet_health.json, written
 * every ~5 min by the on-box exporter /opt/ops/mc_health_export.py via the
 * `fleet-mc-health-export` cron). Polls ~60s.
 *
 *  - header: overall status dot (ok=green/warn=amber/danger=red) + summary +
 *    relative as_of.
 *  - body: one row per checks[] → status dot · key · value · detail.
 *  - footer: host line — disk% · mem MB · load · orphan browsers.
 *
 * Styling matches the Properties/Agents cards (rounded-2xl border-border bg-card).
 */

import { useEffect, useState, useCallback } from 'react'

type Status = 'ok' | 'warn' | 'danger'

interface Check {
  key: string
  status: Status
  value: string
  detail: string
}

interface Health {
  as_of: string
  status: Status
  summary: string
  checks: Check[]
  host: {
    disk_pct: number
    disk_free_gb: number
    mem_avail_mb: number
    swap_used_mb: number
    orphan_browsers: number
    load1: string
  }
  real: boolean
}

const DOT: Record<Status, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
}

const TEXT: Record<Status, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function FleetHealthCard() {
  const [data, setData] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/health', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch health')
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60000) // 60s — exporter writes every ~5min
    return () => clearInterval(interval)
  }, [load])

  if (!data && !error) {
    return <div className="bg-card rounded-2xl border border-border p-4 text-sm text-muted-foreground">Loading fleet health…</div>
  }
  if (error && !data) {
    return <div className="bg-card rounded-2xl border border-border p-4 text-sm text-red-400">Fleet health unavailable: {error}</div>
  }

  const h = data as Health
  const host = h.host

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Header — overall status */}
      <header className="flex items-center gap-3 p-4 border-b border-border">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[h.status]} ${h.status !== 'ok' ? 'animate-pulse' : ''}`} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">🖥 Fleet health</span>
            <span className={`text-xs font-medium uppercase tracking-wide ${TEXT[h.status]}`}>{h.status}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{h.summary}</div>
        </div>
        <div className="ml-auto text-right shrink-0">
          <div className="text-xs text-muted-foreground">updated {relativeTime(h.as_of)}</div>
          {!h.real && <div className="text-[10px] text-amber-400">mock — no live export</div>}
          <button onClick={load} className="text-[10px] underline text-muted-foreground hover:text-foreground">refresh</button>
        </div>
      </header>

      {/* Body — one row per check */}
      <div className="divide-y divide-border">
        {h.checks.map(c => (
          <div key={c.key} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[c.status]}`} />
            <span className="font-medium text-foreground w-32 shrink-0">{c.key}</span>
            <span className={`shrink-0 tabular-nums ${TEXT[c.status]}`}>{c.value}</span>
            <span className="text-xs text-muted-foreground truncate ml-auto text-right">{c.detail}</span>
          </div>
        ))}
      </div>

      {/* Footer — host line */}
      <footer className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>💾 {host.disk_pct}% <span className="opacity-70">({host.disk_free_gb}GB free)</span></span>
        <span>🧠 {host.mem_avail_mb} MB avail</span>
        <span>🔀 swap {host.swap_used_mb} MB</span>
        <span>📈 load {host.load1}</span>
        <span className={host.orphan_browsers > 0 ? TEXT.warn : ''}>🕸 {host.orphan_browsers} orphan{host.orphan_browsers === 1 ? '' : 's'}</span>
      </footer>
    </div>
  )
}

/** Full-page panel wrapper so the card can be a nav-routed view next to Properties/Agents. */
export function EplFleetHealthPanel() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🖥 Fleet health</h1>
        <span className="text-muted-foreground text-sm">VPS &amp; agent fleet, all in one go</span>
      </header>
      <FleetHealthCard />
      <footer className="text-xs text-muted-foreground pt-2 border-t border-border">
        Source: <code>/api/epl/health</code> · on-box exporter <code>/opt/ops/mc_health_export.py</code> (cron <code>fleet-mc-health-export</code>, ~5 min) → <code>/atlas-data/fleet_health.json</code>
      </footer>
    </div>
  )
}
