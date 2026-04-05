'use client'

import { Button } from '@/components/ui/button'
import { StatusBadge } from './status-badge'
import type { HandoffChainParsed } from './types'

interface ChainCardProps {
  chain: HandoffChainParsed
  running: boolean
  onRun: (chain: HandoffChainParsed) => void
  onEdit: (chain: HandoffChainParsed) => void
  onDelete: (chain: HandoffChainParsed) => void
}

export function ChainCard({ chain, running, onRun, onEdit, onDelete }: ChainCardProps): React.JSX.Element {
  return (
    <div className="bg-card border border-border rounded-lg p-3 group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{chain.name}</span>
            <StatusBadge status={chain.status} />
            <span className="text-2xs text-muted-foreground">{chain.steps.length} step{chain.steps.length !== 1 ? 's' : ''}</span>
          </div>
          {chain.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{chain.description}</p>
          )}
          {chain.steps.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
              {chain.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-1 shrink-0">
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground whitespace-nowrap">
                    {step.label || step.agentName || `Step ${i + 1}`}
                  </span>
                  {i < chain.steps.length - 1 && (
                    <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                      <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <Button onClick={() => onRun(chain)} disabled={running} size="xs">
            {running ? '…' : 'Run'}
          </Button>
          <Button onClick={() => onEdit(chain)} variant="secondary" size="icon-xs" title="Edit">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button onClick={() => onDelete(chain)} variant="destructive" size="icon-xs" title="Delete">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  )
}
