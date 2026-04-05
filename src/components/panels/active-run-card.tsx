'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import type { PipelineRun } from './pipeline-types'
import { RunStepsViz } from './pipeline-viz'

interface ActiveRunCardProps {
  run: PipelineRun
  onAdvance: (id: number, success: boolean) => void
  onCancel: (id: number) => void
}

/** Active run card shown at top of pipeline tab */
export function ActiveRunCard({ run, onAdvance, onCancel }: ActiveRunCardProps): React.JSX.Element {
  return (
    <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {run.pipeline_name || `Pipeline #${run.pipeline_id}`} — Run #{run.id}
          </span>
        </div>
        <span className="text-2xs text-muted-foreground">
          Step {run.current_step + 1}/{run.steps_snapshot.length}
        </span>
      </div>
      <RunStepsViz steps={run.steps_snapshot} />
      <div className="flex gap-1 mt-2">
        <Button onClick={() => onAdvance(run.id, true)} variant="success" size="xs" className="bg-green-500/20 text-green-400 hover:bg-green-500/30 h-6 text-2xs">
          Step Done
        </Button>
        <Button onClick={() => onAdvance(run.id, false)} variant="destructive" size="xs" className="bg-red-500/20 text-red-400 hover:bg-red-500/30 h-6 text-2xs">
          Step Failed
        </Button>
        <Button onClick={() => onCancel(run.id)} variant="secondary" size="xs" className="h-6 text-2xs ml-auto">
          Cancel
        </Button>
      </div>
    </div>
  )
}
