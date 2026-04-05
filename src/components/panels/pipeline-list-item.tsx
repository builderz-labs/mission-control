'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import type { Pipeline, PipelineRun } from './pipeline-types'
import { PipelineViz, RunStepsViz, RunStatusBadge } from './pipeline-viz'

interface PipelineListItemProps {
  pipeline: Pipeline
  runs: PipelineRun[]
  expandedId: number | null
  spawning: number | null
  onToggleExpand: (id: number) => void
  onRun: (id: number) => void
  onEdit: (p: Pipeline) => void
  onDelete: (id: number) => void
  onAdvance: (runId: number, success: boolean) => void
  onCancel: (runId: number) => void
}

export function PipelineListItem({
  pipeline: p,
  runs,
  expandedId,
  spawning,
  onToggleExpand,
  onRun,
  onEdit,
  onDelete,
  onAdvance,
  onCancel,
}: PipelineListItemProps): React.JSX.Element {
  const isExpanded = expandedId === p.id
  const pipelineRuns = runs.filter(r => r.pipeline_id === p.id).slice(0, 3)

  return (
    <div className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
      <div className="flex items-center gap-2 p-2">
        <PipelineSummaryButton
          pipeline={p}
          isExpanded={isExpanded}
          onToggle={() => onToggleExpand(p.id)}
        />
        <PipelineActions
          pipelineId={p.id}
          spawning={spawning}
          onRun={onRun}
          onEdit={() => onEdit(p)}
          onDelete={() => onDelete(p.id)}
        />
      </div>

      {isExpanded && (
        <ExpandedPipelineView
          pipeline={p}
          runs={pipelineRuns}
          onAdvance={onAdvance}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

function PipelineSummaryButton({
  pipeline: p,
  isExpanded,
  onToggle,
}: {
  pipeline: Pipeline
  isExpanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      onClick={onToggle}
      className="flex-1 min-w-0 text-left h-auto p-0 rounded-none"
      aria-expanded={isExpanded}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
        <span className="text-2xs text-muted-foreground">{p.steps.length} steps</span>
        {p.use_count > 0 && <span className="text-2xs text-muted-foreground">{p.use_count}x</span>}
        {p.runs.running > 0 && (
          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">running</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 mt-1">
        {p.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <span className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[80px]">
              {s.template_name}
            </span>
            {i < p.steps.length - 1 && (
              <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </Button>
  )
}

function PipelineActions({
  pipelineId,
  spawning,
  onRun,
  onEdit,
  onDelete,
}: {
  pipelineId: number
  spawning: number | null
  onRun: (id: number) => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
      <Button onClick={() => onRun(pipelineId)} disabled={spawning === pipelineId} size="xs">
        {spawning === pipelineId ? '...' : 'Run'}
      </Button>
      <Button onClick={onEdit} variant="secondary" size="icon-xs" title="Edit">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      <Button onClick={onDelete} variant="destructive" size="icon-xs" title="Delete">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </Button>
    </div>
  )
}

function ExpandedPipelineView({
  pipeline: p,
  runs,
  onAdvance,
  onCancel,
}: {
  pipeline: Pipeline
  runs: PipelineRun[]
  onAdvance: (runId: number, success: boolean) => void
  onCancel: (runId: number) => void
}): React.JSX.Element {
  return (
    <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2 space-y-3">
      <PipelineViz steps={p.steps} />
      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

      <div>
        <span className="text-2xs text-muted-foreground">
          Runs: {p.runs.total} total, {p.runs.completed} completed, {p.runs.failed} failed
        </span>
        {runs.map(run => (
          <RunSummaryRow
            key={run.id}
            run={run}
            onAdvance={onAdvance}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  )
}

function RunSummaryRow({
  run,
  onAdvance,
  onCancel,
}: {
  run: PipelineRun
  onAdvance: (runId: number, success: boolean) => void
  onCancel: (runId: number) => void
}): React.JSX.Element {
  return (
    <div className="mt-1 p-2 rounded bg-secondary/50 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">Run #{run.id}</span>
        <RunStatusBadge status={run.status} />
      </div>
      <RunStepsViz steps={run.steps_snapshot} />
      {run.status === 'running' && (
        <div className="flex gap-1 mt-1.5">
          <Button onClick={() => onAdvance(run.id, true)} variant="success" size="xs" className="bg-green-500/20 text-green-400 hover:bg-green-500/30 h-6 text-2xs">
            Mark Step Done
          </Button>
          <Button onClick={() => onAdvance(run.id, false)} variant="destructive" size="xs" className="bg-red-500/20 text-red-400 hover:bg-red-500/30 h-6 text-2xs">
            Mark Step Failed
          </Button>
          <Button onClick={() => onCancel(run.id)} variant="secondary" size="xs" className="h-6 text-2xs">
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
