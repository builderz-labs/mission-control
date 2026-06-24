'use client'

/**
 * FleetScheduleCard — every recurring/scheduled fleet job "all in one place" on
 * Mission Control, a sibling to Properties, Agents and Fleet-health.
 *
 * Reads /api/epl/schedule (which loads /atlas-data/mc_schedule.json, written
 * hourly by the on-box exporter /opt/ops/mc_schedule_export.py via the
 * `fleet-mc-schedule-export` cron). Aggregates VPS cron.d + user crontab + Mac
 * crons (pushed by the Mac heartbeat). Polls ~60s.
 *
 *  - header: counts + overall status + sources availability.
 *  - body: agenda grouped by next-run bucket (Overdue / Next 24h / This week /
 *    Later / No schedule). Each row → last-run status dot · name · agent ·
 *    cadence · next-run · last-run.
 *
 * Styling matches the Fleet-Health / Properties cards (rounded-2xl border bg-card).
 */

import { useEffect, useMemo, useState, useCallback } from 'react'

type SourceStatus = 'ok' | 'warn' | 'danger' | 'stale' | 'unavailable'
type RunStatus = 'pass' | 'fail' | 'unknown'

interface Source {
  key: string
  status: SourceStatus
  detail: string
}

interface Job {
  host: 'vps' | 'mac'
  source: string
  agent: string
  name: string
  cron: string
  cadence: string
  command: string
  log: string | null
  next_run: string | null
  last_run: string | null
  last_status: RunStatus
  last_detail: string
}

interface Schedule {
  as_of: string
  status: SourceStatus
  sources: Source[]
  jobs: Job[]
  counts: { total: number; vps: number; mac: number; failing: number; unknown: number }
  real: boolean
}

const RUN_DOT: Record<RunStatus, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-red-500',
  unknown: 'bg-zinc-500',
}
const RUN_TEXT: Record<RunStatus, string> = {
  pass: 'text-emerald-400',
  fail: 'text-red-400',
  unknown: 'text-muted-foreground',
}
const SRC_TEXT: Record<SourceStatus, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
  stale: 'text-amber-400',
  unavailable: 'text-muted-foreground',
}

function relPast(iso: string | null): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function relFuture(iso: string | null): string {
  if (!iso) return 'no schedule'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diff = Math.floor((then - Date.now()) / 1000)
  if (diff < 0) return 'due'
  if (diff < 60) return `in ${diff}s`
  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`
  return `in ${Math.floor(diff / 86400)}d`
}

// agenda buckets by next_run
const BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'next24', label: 'Next 24 hours' },
  { id: 'week', label: 'Later this week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No upcoming run' },
] as const

function bucketOf(job: Job): (typeof BUCKETS)[number]['id'] {
  if (!job.next_run) return 'none'
  const diff = Date.parse(job.next_run) - Date.now()
  if (Number.isNaN(diff)) return 'none'
  if (diff < 0) return 'overdue'
  if (diff < 24 * 3600 * 1000) return 'next24'
  if (diff < 7 * 24 * 3600 * 1000) return 'week'
  return 'later'
}

export function FleetScheduleCard() {
  const [data, setData] = useState<Schedule | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAllLater, setShowAllLater] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/schedule', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch schedule')
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60000) // 60s — exporter writes hourly
    return () => clearInterval(interval)
  }, [load])

  const grouped = useMemo(() => {
    const g: Record<string, Job[]> = { overdue: [], next24: [], week: [], later: [], none: [] }
    for (const j of data?.jobs || []) g[bucketOf(j)].push(j)
    return g
  }, [data])

  if (!data && !error) {
    return <div className="bg-card rounded-2xl border border-border p-4 text-sm text-muted-foreground">Loading fleet schedule…</div>
  }
  if (error && !data) {
    return <div className="bg-card rounded-2xl border border-border p-4 text-sm text-red-400">Fleet schedule unavailable: {error}</div>
  }

  const s = data as Schedule
  const c = s.counts

  if (!s.real) {
    return (
      <div className="bg-card rounded-2xl border border-border p-4 text-sm">
        <div className="font-semibold text-foreground mb-1">🗓 Fleet schedule</div>
        <div className="text-amber-400">No live export found — exporter <code>fleet-mc-schedule-export</code> has not written <code>/atlas-data/mc_schedule.json</code> yet.</div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Header — counts + sources */}
      <header className="flex items-start gap-3 p-4 border-b border-border">
        <span className="text-lg leading-none">🗓</span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">Fleet schedule</span>
            <span className="text-xs text-muted-foreground">
              {c.total} jobs · {c.vps} VPS · {c.mac} Mac
            </span>
            {c.failing > 0 && <span className="text-xs font-medium text-red-400">{c.failing} failing</span>}
            {c.unknown > 0 && <span className="text-xs text-muted-foreground">{c.unknown} no log</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            {s.sources.map(src => (
              <span key={src.key} className={SRC_TEXT[src.status]} title={src.detail}>
                {src.key}: {src.status}
              </span>
            ))}
          </div>
        </div>
        <div className="ml-auto text-right shrink-0">
          <div className="text-xs text-muted-foreground">updated {relPast(s.as_of)}</div>
          <button onClick={load} className="text-[10px] underline text-muted-foreground hover:text-foreground">refresh</button>
        </div>
      </header>

      {/* Body — agenda by bucket */}
      <div className="divide-y divide-border">
        {BUCKETS.map(bucket => {
          let jobs = grouped[bucket.id]
          if (!jobs.length) return null
          const truncated = bucket.id === 'later' && !showAllLater && jobs.length > 8
          if (truncated) jobs = jobs.slice(0, 8)
          return (
            <section key={bucket.id}>
              <div className="px-4 py-1.5 bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2">
                {bucket.label}
                <span className="text-muted-foreground/60">({grouped[bucket.id].length})</span>
              </div>
              <div className="divide-y divide-border">
                {jobs.map((j, i) => (
                  <div key={`${j.source}-${j.name}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${RUN_DOT[j.last_status]}`}
                      title={`last run: ${j.last_status} — ${j.last_detail}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-foreground truncate">{j.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{j.agent}</span>
                        {j.host === 'mac' && <span className="text-[10px] text-sky-400 shrink-0"> Mac</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate" title={j.cron}>{j.cadence}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-foreground tabular-nums">{relFuture(j.next_run)}</div>
                      <div className={`text-[10px] ${RUN_TEXT[j.last_status]}`}>
                        last {j.last_status === 'unknown' ? '?' : relPast(j.last_run)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {truncated && (
                <button
                  onClick={() => setShowAllLater(true)}
                  className="w-full px-4 py-1.5 text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  show {grouped[bucket.id].length - 8} more
                </button>
              )}
            </section>
          )
        })}
      </div>

      {/* Footer */}
      <footer className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
        Source: on-box exporter <code>fleet-mc-schedule-export</code> (hourly) → <code>/atlas-data/mc_schedule.json</code>. Last-run from each job&apos;s log tail.
      </footer>
    </div>
  )
}

/** Full-page panel wrapper so the card can be a nav-routed view next to Fleet-health. */
export function EplFleetSchedulePanel() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🗓 Fleet schedule</h1>
        <span className="text-muted-foreground text-sm">Every recurring job — VPS &amp; Mac, when it next runs, did it last pass</span>
      </header>
      <FleetScheduleCard />
    </div>
  )
}
