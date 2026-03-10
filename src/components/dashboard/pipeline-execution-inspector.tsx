'use client'

import type { MissionControlPipelineInspectorStage } from '@/types/mission-control'

export function PipelineExecutionInspector({ stages }: { stages: MissionControlPipelineInspectorStage[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Pipeline Execution Inspector</h2>
      </div>

      <div className="grid gap-3 px-4 pb-4">
        {stages.map((stage) => (
          <div key={stage.key} className="rounded-lg border border-border/60 bg-secondary/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-foreground">{stage.label}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
                  <span>{stage.status}</span>
                  {stage.startTime && <span>{formatTime(stage.startTime)}</span>}
                  {stage.durationMs != null && <span>{formatDuration(stage.durationMs)}</span>}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-2xs ${
                stage.status === 'completed'
                  ? 'bg-green-500/10 text-green-400'
                  : stage.status === 'running'
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : stage.status === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-secondary text-muted-foreground'
              }`}>
                {stage.status}
              </span>
            </div>
            <div className="mt-2 text-2xs text-muted-foreground">
              Agents: {stage.agentsInvolved.length > 0 ? stage.agentsInvolved.join(', ') : 'None'}
            </div>
            <div className="mt-2 space-y-1">
              {stage.logs.slice(0, 3).map((log, index) => (
                <div key={index} className="rounded bg-background/40 px-2 py-1 text-2xs text-muted-foreground">
                  {log}
                </div>
              ))}
              {stage.logs.length === 0 && (
                <div className="text-2xs text-muted-foreground">No logs captured for this stage.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(durationMs: number) {
  if (durationMs < 60_000) return `${Math.floor(durationMs / 1000)}s`
  if (durationMs < 3_600_000) return `${Math.floor(durationMs / 60_000)}m`
  return `${Math.floor(durationMs / 3_600_000)}h`
}
