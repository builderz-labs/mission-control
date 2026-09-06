'use client'

import { EngineLogoForText } from '@/components/brand/engine-logo'
import { Button } from '@/components/ui/button'
import { workingDirLeaf } from '@/lib/chat-display'
import { sessionTitle } from '@/lib/chat-session-identity'
import { cliKindLabel, normalizeCliKind } from '@/lib/cli-session-kinds'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import type { DashboardData } from './widget-primitives'

type ActiveTerminalSessionsProps = Pick<
  DashboardData,
  'sessions' | 'isSessionsLoading' | 'navigateToPanel' | 'openSession'
>

export function ActiveTerminalSessions({ data }: { data: ActiveTerminalSessionsProps }) {
  const activeSessions = data.sessions.filter((session) => session.active)

  return (
    <section aria-labelledby="active-terminal-sessions-title" className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />
            <h2 id="active-terminal-sessions-title" className="text-base font-semibold text-foreground">
              Active Terminal Sessions
            </h2>
            {!data.isSessionsLoading && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-2xs text-emerald-300">
                {activeSessions.length} live
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Live work across local agent CLIs and remote gateway sessions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => data.navigateToPanel('sessions')}>
          View all sessions
        </Button>
      </div>

      {data.isSessionsLoading ? (
        <div role="status" className="px-5 py-8 text-center text-xs text-muted-foreground">
          Loading active sessions…
        </div>
      ) : activeSessions.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-foreground">No active terminal sessions</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Start a local CLI session or connect a remote gateway to see live work here.
          </p>
        </div>
      ) : (
        <div className="grid max-h-[28rem] grid-cols-1 gap-px overflow-y-auto bg-border/40 sm:grid-cols-2 xl:grid-cols-3">
          {activeSessions.map((session) => (
            <ActiveTerminalRow
              key={`${session.source || 'session'}:${session.kind || 'gateway'}:${session.id}`}
              session={session}
              onOpen={data.openSession}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ActiveTerminalRow({
  session,
  onOpen,
}: {
  session: DashboardSession
  onOpen: (session: DashboardSession) => void
}) {
  const title = sessionTitle({
    customTitle: session.title,
    lastUserPrompt: session.lastUserPrompt,
    kind: session.kind || 'gateway',
    id: session.id,
  })
  const source = terminalSource(session)
  const owner = session.project || session.agent || workingDirLeaf(session.workingDir) || 'Unassigned agent'

  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      aria-label={`Open ${title}, ${source.label}`}
      className="group flex min-w-0 items-center gap-3 bg-card px-4 py-3 text-left transition-smooth hover:bg-secondary/30 focus-visible:z-10"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface-1">
        <EngineLogoForText text={`${session.kind || ''} ${session.model || ''}`} size={20} decorative />
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {cliKindLabel(session.kind)} · {owner}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block rounded-full px-2 py-0.5 text-[10px] font-medium ${source.className}`}>
          {source.label}
        </span>
        <span className="mt-1 block font-mono text-[10px] text-muted-foreground/70">
          {session.age || 'Live now'}
        </span>
      </span>
    </button>
  )
}

function terminalSource(session: DashboardSession): { label: string; className: string } {
  const isRemote = session.source === 'gateway'
    || (session.source == null && normalizeCliKind(session.kind) === 'gateway')
  return isRemote
    ? { label: 'Remote', className: 'bg-sky-500/10 text-sky-300' }
    : { label: 'Local CLI', className: 'bg-violet-500/10 text-violet-300' }
}
