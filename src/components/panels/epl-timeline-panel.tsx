'use client'

/**
 * EPL Agent Cockpit — Timeline (swimlanes).
 *
 * One lane per agent across a rolling 5-week window centred on `week_now`
 * (week_now-2 .. week_now+2). Each item is a bar spanning start_week..end_week,
 * coloured by status (shipped / building / blocked / planned).
 *
 * Read-only. Source: /api/epl/cockpit (Atlas export). When the export is absent
 * the route returns source:'empty' → this panel shows an honest empty state,
 * never canned data.
 */

import { useEffect, useState, useCallback } from 'react'

type Status = 'shipped' | 'building' | 'blocked' | 'planned'

interface TimelineItem {
  title: string
  status: Status
  start_week: number
  end_week: number
}
interface Lane {
  agent: string
  items: TimelineItem[]
}
interface CockpitData {
  generated_at: string
  week_now: number
  timeline: Lane[]
  source: 'live' | 'empty'
}

const WINDOW = 5 // rolling 5-week window

const STATUS_CLASS: Record<Status, string> = {
  shipped:  'bg-emerald-500/80 text-white border-emerald-400/60',
  building: 'bg-blue-500/80 text-white border-blue-400/60',
  blocked:  'bg-rose-500/80 text-white border-rose-400/60',
  planned:  'bg-secondary text-secondary-foreground border-border border-dashed',
}

const STATUS_DOT: Record<Status, string> = {
  shipped: 'bg-emerald-500',
  building: 'bg-blue-500',
  blocked: 'bg-rose-500',
  planned: 'bg-muted-foreground/50',
}

export function EplTimelinePanel() {
  const [data, setData] = useState<CockpitData | null>(null)

  const load = useCallback(async () => {
    const d = await fetch('/api/epl/cockpit', { cache: 'no-store' }).then(r => r.json())
    setData(d)
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading timeline…</div>

  const weekNow = data.week_now
  const startWeek = weekNow - Math.floor(WINDOW / 2)
  const weeks = Array.from({ length: WINDOW }, (_, i) => startWeek + i)
  const inWindow = (it: TimelineItem) => it.end_week >= weeks[0] && it.start_week <= weeks[WINDOW - 1]

  const lanes = data.timeline
    .map(l => ({ ...l, items: l.items.filter(inWindow) }))
    .filter(l => l.items.length > 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🛤 Timeline</h1>
        <span className="text-muted-foreground">
          {lanes.length} agent{lanes.length === 1 ? '' : 's'} · weeks {weeks[0]}–{weeks[WINDOW - 1]} (now W{weekNow})
        </span>
        {data.source === 'empty' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
            waiting on Atlas export
          </span>
        )}
        <button onClick={load} className="ml-auto text-xs underline text-muted-foreground hover:text-foreground">refresh</button>
      </header>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
        {(['shipped', 'building', 'blocked', 'planned'] as Status[]).map(s => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />{s}
          </span>
        ))}
      </div>

      {lanes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {data.source === 'empty'
            ? 'No cockpit export yet — Atlas writes /atlas-data/mc_cockpit.json. This populates once the exporter lands.'
            : 'No timeline items in the current 5-week window.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          {/* Week header */}
          <div className="grid items-center text-xs text-muted-foreground border-b border-border" style={{ gridTemplateColumns: `140px repeat(${WINDOW}, minmax(110px, 1fr))` }}>
            <div className="px-3 py-2 font-medium">Agent</div>
            {weeks.map(w => (
              <div key={w} className={`px-3 py-2 text-center ${w === weekNow ? 'font-semibold text-foreground' : ''}`}>
                W{w}{w === weekNow ? ' • now' : ''}
              </div>
            ))}
          </div>
          {/* Lanes */}
          {lanes.map(lane => (
            <div key={lane.agent} className="grid items-stretch border-b border-border/60 last:border-b-0" style={{ gridTemplateColumns: `140px repeat(${WINDOW}, minmax(110px, 1fr))` }}>
              <div className="px-3 py-3 text-sm font-medium text-foreground capitalize flex items-center">{lane.agent}</div>
              {/* one cell holding all bars, spanning the week columns */}
              <div className="relative py-2 px-1" style={{ gridColumn: `2 / span ${WINDOW}` }}>
                <div className="space-y-1.5">
                  {lane.items.map((it, idx) => {
                    const from = Math.max(it.start_week, weeks[0])
                    const to = Math.min(it.end_week, weeks[WINDOW - 1])
                    const leftPct = ((from - weeks[0]) / WINDOW) * 100
                    const widthPct = ((to - from + 1) / WINDOW) * 100
                    return (
                      <div key={idx} className="relative h-7">
                        <div
                          className={`absolute top-0 h-7 rounded-lg border px-2 flex items-center text-[11px] font-medium truncate ${STATUS_CLASS[it.status]}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 44 }}
                          title={`${it.title} · ${it.status} · W${it.start_week}–W${it.end_week}`}
                        >
                          <span className="truncate">{it.title}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="text-xs text-muted-foreground pt-2">
        Source: <code>/api/epl/cockpit</code> · {data.source === 'live' ? `live · generated ${new Date(data.generated_at).toLocaleString()}` : 'empty (no export yet)'}
      </footer>
    </div>
  )
}
