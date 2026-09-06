'use client'

import { sessionTitle } from '@/lib/chat-session-identity'
import { cliKindLabel } from '@/lib/cli-session-kinds'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import { EngineLogoForText } from '@/components/brand/engine-logo'

export function SessionWorkbenchRow({
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

  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-secondary/20 transition-smooth"
    >
      <div aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${session.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
      <EngineLogoForText text={`${session.kind} ${session.model || ''}`} size={16} decorative />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        <div className="text-2xs text-muted-foreground truncate">
          <span className="sr-only">Status: {session.active ? 'Active' : 'Idle'}. </span>
          {cliKindLabel(session.kind)}
          {' · '}
          {session.project || session.agent || session.environment || session.kind}
          {' · '}
          {session.model?.split('/').pop() || 'unknown'}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-2xs font-mono-tight text-muted-foreground">{session.tokens}</div>
        <div className="text-2xs text-muted-foreground">{session.age}</div>
      </div>
    </button>
  )
}
