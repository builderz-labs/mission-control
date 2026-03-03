'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl, CronJob } from '@/store'

type ViewMode = 'day' | 'week' | 'month' | 'agenda'

interface CalendarEvent {
  job: CronJob
  time: Date
  type: 'past' | 'next' | 'projected'
}

/**
 * Minimal cron expression parser.
 * Supports: *, numbers, ranges (1-5), steps (*​/5), lists (1,3,5).
 */
function expandCronField(field: string, min: number, max: number): number[] {
  const results = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? parseInt(stepMatch[2]) : 1
    const range = stepMatch ? stepMatch[1] : part

    if (range === '*') {
      for (let i = min; i <= max; i += step) results.add(i)
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      for (let i = a; i <= b; i += step) results.add(i)
    } else {
      results.add(parseInt(range))
    }
  }
  return [...results].filter(n => n >= min && n <= max).sort((a, b) => a - b)
}

function getNextOccurrences(schedule: string, count: number, from: Date): Date[] {
  // Strip timezone suffix like "(America/New_York)"
  const expr = schedule.replace(/\s*\(.*\)\s*$/, '').trim()
  const parts = expr.split(/\s+/)
  if (parts.length < 5) return []

  const [minF, hourF, domF, monF, dowF] = parts
  const minutes = expandCronField(minF, 0, 59)
  const hours = expandCronField(hourF, 0, 23)
  const doms = expandCronField(domF, 1, 31)
  const months = expandCronField(monF, 1, 12)
  const dows = expandCronField(dowF, 0, 6)

  const results: Date[] = []
  const cursor = new Date(from)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  const maxIter = 525600 // 1 year of minutes
  for (let i = 0; i < maxIter && results.length < count; i++) {
    const m = cursor.getMinutes()
    const h = cursor.getHours()
    const dom = cursor.getDate()
    const mon = cursor.getMonth() + 1
    const dow = cursor.getDay()

    if (
      minutes.includes(m) &&
      hours.includes(h) &&
      doms.includes(dom) &&
      months.includes(mon) &&
      dows.includes(dow)
    ) {
      results.push(new Date(cursor))
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return results
}

const statusBadge: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
}

const jobColor = (idx: number) => {
  const colors = [
    'border-l-blue-500 bg-blue-500/10',
    'border-l-emerald-500 bg-emerald-500/10',
    'border-l-violet-500 bg-violet-500/10',
    'border-l-amber-500 bg-amber-500/10',
    'border-l-rose-500 bg-rose-500/10',
    'border-l-cyan-500 bg-cyan-500/10',
    'border-l-indigo-500 bg-indigo-500/10',
    'border-l-teal-500 bg-teal-500/10',
  ]
  return colors[idx % colors.length]
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function startOfDay(d: Date) {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function CronCalendarPanel() {
  const { cronJobs, setCronJobs } = useMissionControl()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [viewDate, setViewDate] = useState(new Date())
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cron?action=list')
      const data = await res.json()
      setCronJobs(data.jobs || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [setCronJobs])

  useEffect(() => { loadJobs() }, [loadJobs])

  const filteredJobs = useMemo(() =>
    filter ? cronJobs.filter(j => j.name.toLowerCase().includes(filter.toLowerCase())) : cronJobs,
    [cronJobs, filter]
  )

  // Build calendar events for the visible date range
  const events = useMemo(() => {
    const results: CalendarEvent[] = []
    const now = new Date()

    let rangeStart: Date
    let rangeEnd: Date

    if (viewMode === 'day') {
      rangeStart = startOfDay(viewDate)
      rangeEnd = addDays(rangeStart, 1)
    } else if (viewMode === 'week') {
      const dow = viewDate.getDay()
      rangeStart = startOfDay(addDays(viewDate, -dow))
      rangeEnd = addDays(rangeStart, 7)
    } else {
      rangeStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
      rangeEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0, 23, 59, 59)
    }

    for (const job of filteredJobs) {
      // Add lastRun event
      if (job.lastRun) {
        const d = new Date(job.lastRun)
        if (d >= rangeStart && d <= rangeEnd) {
          results.push({ job, time: d, type: 'past' })
        }
      }

      // Add nextRun event
      if (job.nextRun) {
        const d = new Date(job.nextRun)
        if (d >= rangeStart && d <= rangeEnd) {
          results.push({ job, time: d, type: 'next' })
        }
      }

      // Project future occurrences from cron expression
      if (job.enabled) {
        const projFrom = job.nextRun ? new Date(job.nextRun) : now
        const projected = getNextOccurrences(job.schedule, 200, projFrom)
        for (const d of projected) {
          if (d > rangeEnd) break
          if (d >= rangeStart) {
            // Don't duplicate the nextRun event
            if (job.nextRun && Math.abs(d.getTime() - job.nextRun) < 60000) continue
            results.push({ job, time: d, type: 'projected' })
          }
        }
      }
    }

    results.sort((a, b) => a.time.getTime() - b.time.getTime())
    return results
  }, [filteredJobs, viewMode, viewDate])

  // Navigation
  const navigate = (dir: -1 | 1) => {
    setViewDate(prev => {
      if (viewMode === 'day') return addDays(prev, dir)
      if (viewMode === 'week') return addDays(prev, dir * 7)
      const r = new Date(prev)
      r.setMonth(r.getMonth() + dir)
      return r
    })
  }

  const goToday = () => setViewDate(new Date())

  // Format header label
  const headerLabel = useMemo(() => {
    if (viewMode === 'day') return viewDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    if (viewMode === 'week') {
      const dow = viewDate.getDay()
      const start = addDays(viewDate, -dow)
      const end = addDays(start, 6)
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    return viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }, [viewMode, viewDate])

  // Render agenda view (list)
  const renderAgenda = () => (
    <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
      {events.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">No scheduled events in this range</div>
      ) : events.map((ev, i) => {
        const jIdx = filteredJobs.indexOf(ev.job)
        return (
          <div
            key={`${ev.job.name}-${i}`}
            onClick={() => setSelectedEvent(ev)}
            className={`border-l-4 rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-smooth ${jobColor(jIdx)}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="font-medium text-foreground text-sm">{ev.job.name}</span>
                {ev.job.agentId && <span className="text-xs text-muted-foreground ml-2">({ev.job.agentId})</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${ev.type === 'past' ? 'bg-secondary text-muted-foreground' : ev.type === 'next' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground/70'}`}>
                  {ev.type === 'past' ? 'ran' : ev.type === 'next' ? 'next' : 'projected'}
                </span>
                {ev.type === 'past' && ev.job.lastStatus && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge[ev.job.lastStatus] || ''}`}>{ev.job.lastStatus}</span>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {ev.time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at {formatTime(ev.time)}
            </div>
            <div className="text-xs text-muted-foreground/70 mt-0.5 font-mono truncate">{ev.job.schedule}</div>
          </div>
        )
      })}
    </div>
  )

  // Render day/week grid
  const renderGrid = () => {
    const days: Date[] = []
    if (viewMode === 'day') {
      days.push(startOfDay(viewDate))
    } else {
      const dow = viewDate.getDay()
      const start = startOfDay(addDays(viewDate, -dow))
      for (let i = 0; i < 7; i++) days.push(addDays(start, i))
    }

    const hours = Array.from({ length: 24 }, (_, i) => i)
    const now = new Date()

    return (
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
        <div className={`grid ${viewMode === 'day' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]'} min-w-[600px]`}>
          {/* Header row */}
          <div className="sticky top-0 z-10 bg-card border-b border-border" />
          {days.map(day => (
            <div key={day.toISOString()} className={`sticky top-0 z-10 bg-card border-b border-border px-2 py-2 text-center ${isSameDay(day, now) ? 'bg-primary/5' : ''}`}>
              <div className="text-xs text-muted-foreground">{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div className={`text-sm font-medium ${isSameDay(day, now) ? 'text-primary' : 'text-foreground'}`}>{day.getDate()}</div>
            </div>
          ))}

          {/* Hour rows */}
          {hours.map(hour => (
            <>
              <div key={`h-${hour}`} className="border-b border-border/30 px-1 py-1 text-right">
                <span className="text-xs text-muted-foreground/60">{hour.toString().padStart(2, '0')}:00</span>
              </div>
              {days.map(day => {
                const dayEvents = events.filter(ev => {
                  return isSameDay(ev.time, day) && ev.time.getHours() === hour
                })
                return (
                  <div key={`${day.toISOString()}-${hour}`} className="border-b border-border/30 border-l border-border/20 min-h-[32px] relative px-0.5 py-0.5">
                    {dayEvents.map((ev, i) => {
                      const jIdx = filteredJobs.indexOf(ev.job)
                      return (
                        <div
                          key={`${ev.job.name}-${i}`}
                          onClick={() => setSelectedEvent(ev)}
                          className={`text-[10px] leading-tight rounded px-1 py-0.5 mb-0.5 cursor-pointer truncate border-l-2 ${jobColor(jIdx)} hover:brightness-125 transition-all`}
                          title={`${ev.job.name} at ${formatTime(ev.time)}`}
                        >
                          <span className="font-medium">{formatTime(ev.time)}</span> {ev.job.name}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>
    )
  }

  // Render month grid
  const renderMonth = () => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const startDow = firstDay.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const now = new Date()

    const cells: (Date | null)[] = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

    return (
      <div className="overflow-auto max-h-[calc(100vh-280px)]">
        <div className="grid grid-cols-7 gap-px bg-border/20 rounded-lg overflow-hidden">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="bg-card px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`e-${i}`} className="bg-card min-h-[80px]" />
            const dayEvents = events.filter(ev => isSameDay(ev.time, day))
            return (
              <div key={day.toISOString()} className={`bg-card min-h-[80px] p-1 ${isSameDay(day, now) ? 'ring-1 ring-primary/40' : ''}`}>
                <div className={`text-xs font-medium mb-1 ${isSameDay(day, now) ? 'text-primary' : 'text-muted-foreground'}`}>{day.getDate()}</div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev, j) => {
                    const jIdx = filteredJobs.indexOf(ev.job)
                    return (
                      <div
                        key={`${ev.job.name}-${j}`}
                        onClick={() => setSelectedEvent(ev)}
                        className={`text-[9px] leading-tight rounded px-1 py-0.5 cursor-pointer truncate border-l-2 ${jobColor(jIdx)}`}
                        title={`${ev.job.name} at ${formatTime(ev.time)}`}
                      >
                        {ev.job.name}
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <div className="text-[9px] text-muted-foreground/60 px-1">+{dayEvents.length - 3} more</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cron Calendar</h1>
            <p className="text-muted-foreground mt-1">Visualize all scheduled jobs across agents</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter jobs..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="px-3 py-1.5 text-sm bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-40"
            />
            <button onClick={loadJobs} disabled={loading} className="px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth disabled:opacity-50">
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="px-2 py-1 text-sm bg-secondary text-muted-foreground rounded hover:bg-surface-2 transition-smooth">&lt;</button>
          <button onClick={goToday} className="px-3 py-1 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20 transition-smooth">Today</button>
          <button onClick={() => navigate(1)} className="px-2 py-1 text-sm bg-secondary text-muted-foreground rounded hover:bg-surface-2 transition-smooth">&gt;</button>
          <span className="text-sm font-medium text-foreground ml-2">{headerLabel}</span>
        </div>
        <div className="flex rounded-md overflow-hidden border border-border">
          {(['day', 'week', 'month', 'agenda'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-sm capitalize transition-smooth ${viewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Jobs: <strong className="text-foreground">{filteredJobs.length}</strong></span>
        <span>Events in range: <strong className="text-foreground">{events.length}</strong></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Enabled: {filteredJobs.filter(j => j.enabled).length}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />Disabled: {filteredJobs.filter(j => !j.enabled).length}</span>
      </div>

      {/* Calendar body */}
      {viewMode === 'agenda' ? renderAgenda() : viewMode === 'month' ? renderMonth() : renderGrid()}

      {/* Event detail sidebar */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-foreground">{selectedEvent.job.name}</h3>
              <button onClick={() => setSelectedEvent(null)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Schedule:</span></div>
                <div className="font-mono text-xs">{selectedEvent.job.schedule}</div>
                <div><span className="text-muted-foreground">Status:</span></div>
                <div>{selectedEvent.job.enabled ? '🟢 Enabled' : '🔴 Disabled'}</div>
                <div><span className="text-muted-foreground">Event time:</span></div>
                <div>{selectedEvent.time.toLocaleString()}</div>
                <div><span className="text-muted-foreground">Event type:</span></div>
                <div className="capitalize">{selectedEvent.type}</div>
                {selectedEvent.job.agentId && (
                  <><div><span className="text-muted-foreground">Agent:</span></div><div>{selectedEvent.job.agentId}</div></>
                )}
                {selectedEvent.job.lastRun && (
                  <><div><span className="text-muted-foreground">Last run:</span></div><div>{new Date(selectedEvent.job.lastRun).toLocaleString()}</div></>
                )}
                {selectedEvent.job.lastStatus && (
                  <><div><span className="text-muted-foreground">Last status:</span></div><div><span className={`px-1.5 py-0.5 rounded text-xs ${statusBadge[selectedEvent.job.lastStatus] || ''}`}>{selectedEvent.job.lastStatus}</span></div></>
                )}
                {selectedEvent.job.nextRun && (
                  <><div><span className="text-muted-foreground">Next run:</span></div><div>{new Date(selectedEvent.job.nextRun).toLocaleString()}</div></>
                )}
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Command:</span>
                <code className="text-xs bg-secondary rounded p-2 block font-mono whitespace-pre-wrap break-all">{selectedEvent.job.command}</code>
              </div>
              {selectedEvent.job.lastError && (
                <div>
                  <span className="text-red-400 block mb-1">Last error:</span>
                  <code className="text-xs bg-red-500/10 text-red-300 rounded p-2 block font-mono whitespace-pre-wrap">{selectedEvent.job.lastError}</code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
