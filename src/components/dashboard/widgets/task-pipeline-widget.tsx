'use client'

import type { DashboardData } from '../widget-primitives'

interface PipelineStage {
  label: string
  count: number
  color: string
  bgColor: string
  dotColor: string
}

export function TaskPipelineWidget({ data }: { data: DashboardData }) {
  const { inboxCount, assignedCount, runningTasks, reviewCount, doneCount, navigateToPanel } = data

  const total = inboxCount + assignedCount + runningTasks + reviewCount + doneCount

  const stages: PipelineStage[] = [
    { label: 'Inbox', count: inboxCount, color: 'text-zinc-400', bgColor: 'bg-zinc-500', dotColor: 'bg-zinc-400' },
    { label: 'Assigned', count: assignedCount, color: 'text-blue-400', bgColor: 'bg-blue-500', dotColor: 'bg-blue-400' },
    { label: 'Running', count: runningTasks, color: 'text-amber-400', bgColor: 'bg-amber-500', dotColor: 'bg-amber-400' },
    { label: 'Review', count: reviewCount, color: 'text-purple-400', bgColor: 'bg-purple-500', dotColor: 'bg-purple-400' },
    { label: 'Done', count: doneCount, color: 'text-green-400', bgColor: 'bg-green-500', dotColor: 'bg-green-400' },
  ]

  const hasBottleneck = reviewCount > 3

  if (total === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3 className="text-sm font-semibold">Task Pipeline</h3>
          <span className="text-2xs text-muted-foreground font-mono-tight">0 tasks</span>
        </div>
        <button
          type="button"
          className="w-full text-left border-0 bg-transparent panel-body cursor-pointer hover:bg-secondary/20 transition-smooth rounded-b-lg"
          onClick={() => navigateToPanel('tasks')}
        >
          <p className="text-xs text-muted-foreground/50 text-center py-2">No tasks yet</p>
        </button>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Task Pipeline</h3>
        <span className="text-2xs text-muted-foreground font-mono-tight">{total} total</span>
      </div>
      <button
        type="button"
        className="w-full text-left border-0 bg-transparent panel-body cursor-pointer hover:bg-secondary/20 transition-smooth rounded-b-lg"
        onClick={() => navigateToPanel('tasks')}
      >
        {/* Stage pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {stages.map((stage, i) => {
            const hasItems = stage.count > 0
            return (
              <div key={stage.label} className="flex items-center gap-1.5">
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors ${
                  hasItems
                    ? `${stage.bgColor}/10 border-current/15 ${stage.color}`
                    : 'bg-secondary/30 border-border/20 text-muted-foreground/30'
                }`}>
                  {hasItems && (
                    <span className={`size-1.5 rounded-full ${stage.dotColor} ${
                      stage.label === 'Running' ? 'animate-pulse' : ''
                    }`} />
                  )}
                  <span className="text-2xs font-medium">{stage.label}</span>
                  <span className={`text-2xs font-mono-tight ${hasItems ? 'opacity-80' : 'opacity-40'}`}>
                    {stage.count}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <svg className="size-3 text-muted-foreground/20 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                )}
              </div>
            )
          })}
        </div>

        {/* Bottleneck warning */}
        {hasBottleneck && (
          <p className="text-2xs text-amber-400/80 mt-2.5 flex items-center gap-1">
            <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 2l6.5 11H1.5z" />
              <path d="M8 7v2.5M8 11.5v0" />
            </svg>
            {reviewCount} tasks waiting for review
          </p>
        )}
      </button>
    </div>
  )
}
