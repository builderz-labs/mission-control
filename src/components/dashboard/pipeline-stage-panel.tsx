'use client'

import type { MissionControlPipelineStage } from '@/types/mission-control'

export function PipelineStagePanel({ stages }: { stages: MissionControlPipelineStage[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Pipeline View</h2>
      </div>

      <div className="panel-body">
        <div className="grid gap-2 md:grid-cols-5">
          {stages.map((stage) => (
            <div
              key={stage.key}
              className={`rounded-lg border px-3 py-3 ${
                stage.status === 'completed'
                  ? 'border-green-500/30 bg-green-500/10'
                  : stage.status === 'running'
                  ? 'border-cyan-500/30 bg-cyan-500/10'
                  : stage.status === 'error'
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-border bg-secondary/20'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-foreground">{stage.label}</span>
                <span className={`text-sm ${
                  stage.status === 'completed'
                    ? 'text-green-400'
                    : stage.status === 'running'
                    ? 'text-cyan-400'
                    : stage.status === 'error'
                    ? 'text-red-400'
                    : 'text-muted-foreground'
                }`}>
                  {stage.status === 'completed' ? '✔' : stage.status === 'running' ? '●' : stage.status === 'error' ? '!' : '○'}
                </span>
              </div>
              <div className="mt-2 text-2xs uppercase tracking-wide text-muted-foreground">{stage.status}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
