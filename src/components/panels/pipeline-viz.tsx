'use client'

import React from 'react'
import type { PipelineStep, RunStepState } from './pipeline-types'

/** Full step visualization with boxes and arrows */
export function PipelineViz({ steps }: { steps: PipelineStep[] }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-0.5">
            <div className="px-2 py-1.5 rounded-md border border-border bg-secondary text-xs font-medium text-foreground whitespace-nowrap">
              {s.template_name || `Step ${i + 1}`}
            </div>
            {s.on_failure === 'continue' && (
              <span className="text-2xs text-amber-400">continue on fail</span>
            )}
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 20 12" fill="none" className="w-5 h-3 text-muted-foreground/60 shrink-0">
              <path d="M0 6h16M13 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

/** Run steps visualization with colored status dots */
export function RunStepsViz({ steps }: { steps: RunStepState[] }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              s.status === 'completed' ? 'bg-green-500' :
              s.status === 'running' ? 'bg-amber-500 animate-pulse' :
              s.status === 'failed' ? 'bg-red-500' :
              s.status === 'skipped' ? 'bg-gray-500' : 'bg-gray-600'
            }`} />
            <span className={`text-2xs whitespace-nowrap ${
              s.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'
            }`}>
              {s.template_name}
            </span>
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 8 8" className="w-2 h-2 text-muted-foreground/40 shrink-0">
              <path d="M1 4h6M5 2l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

export function RunStatusBadge({ status }: { status: string }): React.JSX.Element {
  const styles: Record<string, string> = {
    running: 'bg-amber-500/20 text-amber-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${styles[status] || 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}
