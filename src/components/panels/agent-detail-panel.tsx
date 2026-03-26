'use client'

import { Agent } from '@/store/index'
import { StatusBadge } from '@/components/ui/status-badge'
import { getAgentIdentity, getFreshnessLabel } from '@/lib/agent-identity'

interface AgentDetailPanelProps {
  agent: Agent | null
  onClose: () => void
  className?: string
}

function mapAgentStatus(status: Agent['status']): 'running' | 'idle' | 'busy' | 'crashed' | 'offline' {
  switch (status) {
    case 'busy': return 'busy'
    case 'error': return 'crashed'
    case 'idle': return 'idle'
    case 'offline': return 'offline'
    default: return 'offline'
  }
}

export function AgentDetailPanel({ agent, onClose, className = '' }: AgentDetailPanelProps) {
  if (!agent) return null

  const identity = getAgentIdentity(agent.name)
  const mappedStatus = mapAgentStatus(agent.status)

  const isOpen = agent !== null

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        className={`fixed right-0 top-0 h-full w-[400px] z-50 flex flex-col bg-[var(--surface)] border-l border-[var(--border)] ${className}`}
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Agent detail: ${agent.name}`}
      >
        {/* Header bar — sticky top */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-4 py-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-lg text-[var(--text-primary)] truncate leading-tight">
                {agent.name}
              </h2>
              <div className="mt-1">
                <StatusBadge status={mappedStatus} />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
                {identity.roleTitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded transition-colors duration-150"
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Overview section */}
          <div className="px-4 py-4 border-b border-[var(--border)]">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {identity.oneLiner}
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text-secondary)]">
                {identity.tier}
              </span>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {identity.runtime || 'Unknown'}
              </span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="px-4 py-4 border-b border-[var(--border)]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Last Seen
                </p>
                <p className="font-mono text-sm text-[var(--text-primary)]">
                  {getFreshnessLabel(agent.last_seen)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Tasks Active
                </p>
                <p className="font-mono text-sm text-[var(--text-primary)]">
                  {agent.taskStats?.in_progress ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Tasks Done
                </p>
                <p className="font-mono text-sm text-[var(--text-primary)]">
                  {agent.taskStats?.done ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Total Tasks
                </p>
                <p className="font-mono text-sm text-[var(--text-primary)]">
                  {agent.taskStats?.total ?? 0}
                </p>
              </div>
            </div>
          </div>

          {/* Capabilities section — only if capabilities exist */}
          {identity.capabilities.length > 0 && (
            <div className="px-4 py-4 border-b border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Capabilities
              </p>
              <div className="inline-flex flex-wrap gap-1">
                {identity.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-2 py-0.5 text-xs font-mono bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text-secondary)]"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions section */}
          <div className="px-4 py-4">
            {identity.quickAction && (
              <button
                className="w-full px-3 py-2 rounded-md text-sm bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20 hover:bg-[#3b82f6]/20 transition-colors duration-150 text-left"
              >
                {identity.quickAction}
              </button>
            )}
            <button
              className="mt-2 w-full px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors duration-150 text-left"
            >
              View in Chat
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default AgentDetailPanel
