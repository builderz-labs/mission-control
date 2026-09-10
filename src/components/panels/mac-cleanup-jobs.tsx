import { Button } from '@/components/ui/button'
import type { AutomationView } from './mac-cleanup-types'

function formatAge(epochSeconds: number | null): string {
  if (!epochSeconds) return 'never'
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds)
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  return `${Math.floor(delta / 3600)}h ago`
}

function classLabel(value: AutomationView['mutationClass']): string {
  if (value === 'observe') return 'observe only'
  if (value === 'cache') return 'idle caches'
  if (value === 'aggressive') return 'blocked'
  return 'alias'
}

export function MacCleanupJobs({
  automations,
  busyId,
  onRun,
}: {
  automations: AutomationView[]
  busyId: string | null
  onRun: (id: string, mode: 'audit' | 'dry-run' | 'auto') => void
}) {
  return (
    <div className="space-y-2">
      {automations.map((job) => (
        <article key={job.id} className="rounded-xl border border-border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium">{job.label}</h4>
              <p className="text-[11px] text-muted-foreground font-mono">{job.launchdLabel}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
              <span className={job.loaded ? 'text-green-400' : 'text-muted-foreground'}>
                {job.loaded ? 'loaded' : 'unloaded'}
              </span>
              <span className="text-muted-foreground">{classLabel(job.mutationClass)}</span>
              <span className="text-muted-foreground">{formatAge(job.lastCycleAt)}</span>
            </div>
          </div>
          {job.lastStatus && (
            <p className="text-xs text-muted-foreground mt-1">last status: {job.lastStatus}</p>
          )}
          <ul className="mt-2 space-y-1">
            {job.notes.map((note) => (
              <li key={note} className="text-xs text-muted-foreground">{note}</li>
            ))}
          </ul>
          {job.triggerable && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="xs" variant="outline" disabled={busyId === job.id} onClick={() => onRun(job.id, 'audit')}>
                Audit
              </Button>
              <Button size="xs" variant="outline" disabled={busyId === job.id} onClick={() => onRun(job.id, 'dry-run')}>
                Dry-run
              </Button>
              <Button
                size="xs"
                variant={job.mutationClass === 'cache' ? 'default' : 'secondary'}
                disabled={busyId === job.id}
                onClick={() => onRun(job.id, 'auto')}
              >
                {job.id === 'safe-reclaim' ? 'Reclaim' : job.mutationClass === 'cache' ? 'Clean caches' : 'Notify'}
              </Button>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
