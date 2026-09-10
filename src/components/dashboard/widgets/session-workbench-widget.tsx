'use client'

import { useMemo, useState } from 'react'
import { CLI_SESSION_KINDS, cliKindLabel } from '@/lib/cli-session-kinds'
import { filterSessionsByKind, groupSessionsByKind } from '@/lib/dashboard-cli-fleets'
import type { DashboardData } from '../widget-primitives'
import { SessionWorkbenchRow } from './session-workbench-row'
import { Button } from '@/components/ui/button'
import { EngineLogoForText, EngineLogoSet } from '@/components/brand/engine-logo'

const SESSION_PAGE_SIZE = 40

export function SessionWorkbenchWidget({ data }: { data: DashboardData }) {
  const { isLocal, sessions, isSessionsLoading, openSession, cliFleets } = data
  const [kindFilter, setKindFilter] = useState<'all' | 'active' | string>('all')
  const [visibleLimit, setVisibleLimit] = useState(SESSION_PAGE_SIZE)

  const visible = useMemo(() => filterSessionsByKind(sessions, kindFilter), [sessions, kindFilter])
  const visibleRows = useMemo(() => visible.slice(0, visibleLimit), [visible, visibleLimit])
  const grouped = useMemo(() => groupSessionsByKind(visibleRows), [visibleRows])
  const groupOrder = useMemo(() => {
    const leftover = [...grouped.keys()].filter((kind) => !CLI_SESSION_KINDS.includes(kind as typeof CLI_SESSION_KINDS[number]))
    return [...CLI_SESSION_KINDS, ...leftover].filter((kind) => (grouped.get(kind) || []).length > 0)
  }, [grouped])

  const filters = [
    { id: 'all', label: 'All', count: sessions.length },
    { id: 'active', label: 'Active', count: sessions.filter((session) => session.active).length },
    ...cliFleets.map((fleet) => ({ id: fleet.kind, label: fleet.label, count: fleet.total })),
  ]

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">CLI Sessions</h3>
        <span className="text-2xs text-muted-foreground font-mono-tight">{visible.length}/{sessions.length}</span>
      </div>
      <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-border/50">
        {filters.filter((filter) => filter.id === 'all' || filter.id === 'active' || filter.count > 0).map((filter) => {
          const selected = kindFilter === filter.id
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setKindFilter(filter.id)
                setVisibleLimit(SESSION_PAGE_SIZE)
              }}
              className={`min-h-8 rounded-full px-2.5 py-1 text-2xs font-medium transition-smooth ${
                selected
                  ? 'bg-primary/15 text-primary'
                  : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <EngineLogoForText text={filter.id} size={12} decorative />
                <span>{filter.label} {filter.count}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="divide-y divide-border/50 max-h-[32rem] overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {isSessionsLoading ? 'Loading sessions...' : 'No CLI sessions'}
            </p>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground/60">
              {isLocal && <EngineLogoSet kinds={['claude-code', 'codex-cli', 'grok', 'kimi']} size={12} decorative />}
              {isLocal
                ? <span>Start a Claude, Codex, Grok, Kimi, Hermes, or OpenCode session to see it here.</span>
                : 'Local CLI sessions and gateway sessions appear here when they are active.'}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">No sessions match this filter.</div>
        ) : (
          groupOrder.map((kind) => {
            const rows = grouped.get(kind) || []
            return (
              <section key={kind}>
                <div className="sticky top-0 z-[1] px-4 py-1.5 bg-card/90 backdrop-blur-xs flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <EngineLogoForText text={kind} size={12} decorative />
                    {cliKindLabel(kind)}
                  </h4>
                  <span className="text-2xs font-mono-tight text-muted-foreground">{rows.filter((row) => row.active).length} active · {rows.length}</span>
                </div>
                {rows.map((session) => (
                  <SessionWorkbenchRow key={`${session.kind}:${session.id}`} session={session} onOpen={openSession} />
                ))}
              </section>
            )
          })
        )}
        {visible.length > visibleRows.length && (
          <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
            <span className="text-2xs text-muted-foreground">
              Showing {visibleRows.length} of {visible.length} matching sessions
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleLimit((current) => current + SESSION_PAGE_SIZE)}
            >
              Show {Math.min(SESSION_PAGE_SIZE, visible.length - visibleRows.length)} more
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
