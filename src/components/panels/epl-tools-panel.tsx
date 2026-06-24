'use client'

/**
 * EPL Agent Cockpit — Tools / connectors.
 *
 * Per-agent connector list with status (connected / degraded / error / etc.).
 * Read-only. Source: /api/epl/cockpit (Atlas export). Empty export → honest
 * empty state.
 */

import { useEffect, useState, useCallback } from 'react'

interface Connector {
  name: string
  status: string
}
interface ToolsEntry {
  agent: string
  connectors: Connector[]
}
interface CockpitData {
  generated_at: string
  week_now: number
  tools: ToolsEntry[]
  source: 'live' | 'empty'
}

function statusClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'connected' || s === 'ok' || s === 'live') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (s === 'degraded' || s === 'warning' || s === 'review') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (s === 'error' || s === 'down' || s === 'disconnected') return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
  return 'bg-secondary text-secondary-foreground border-border'
}

function statusDot(status: string): string {
  const s = status.toLowerCase()
  if (s === 'connected' || s === 'ok' || s === 'live') return 'bg-emerald-500'
  if (s === 'degraded' || s === 'warning' || s === 'review') return 'bg-amber-500'
  if (s === 'error' || s === 'down' || s === 'disconnected') return 'bg-rose-500'
  return 'bg-muted-foreground/50'
}

export function EplToolsPanel() {
  const [data, setData] = useState<CockpitData | null>(null)

  const load = useCallback(async () => {
    const d = await fetch('/api/epl/cockpit', { cache: 'no-store' }).then(r => r.json())
    setData(d)
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading tools…</div>

  const tools = [...data.tools].sort((a, b) => a.agent.localeCompare(b.agent))
  const totalConnectors = tools.reduce((s, t) => s + t.connectors.length, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🔌 Tools</h1>
        <span className="text-muted-foreground">{tools.length} agents · {totalConnectors} connectors</span>
        {data.source === 'empty' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">waiting on Atlas export</span>
        )}
        <button onClick={load} className="ml-auto text-xs underline text-muted-foreground hover:text-foreground">refresh</button>
      </header>

      {tools.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No connector data yet — populates once Atlas writes the cockpit export.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map(t => (
            <div key={t.agent} className="bg-card rounded-2xl border border-border p-4">
              <div className="text-sm font-medium text-foreground capitalize mb-3">{t.agent}</div>
              <div className="space-y-1.5">
                {t.connectors.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">no connectors</div>
                ) : (
                  t.connectors.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground inline-flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${statusDot(c.status)}`} />{c.name}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(c.status)}`}>{c.status}</span>
                    </div>
                  ))
                )}
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
