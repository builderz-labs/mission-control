'use client'

import { useMemo } from 'react'
import { useMissionControl, type Task, type Activity, type CronJob } from '@/store'
import { DispatchForm } from '@/components/dispatch-form'

/**
 * LabPage — the operational workspace.
 *
 * Layout:
 *   Top:    Dispatch form (hero)
 *   Middle: Review Queue + Schedules (side by side)
 *   Bottom: Operations Log
 */
export function LabPage() {
  const { tasks, activities, cronJobs } = useMissionControl()

  const reviewTasks = useMemo(
    () => tasks.filter(t => t.status === 'review' || t.status === 'quality_review')
      .sort((a, b) => b.updated_at - a.updated_at),
    [tasks]
  )

  const enabledCrons = useMemo(
    () => cronJobs.filter(c => c.enabled).sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)),
    [cronJobs]
  )

  const recentOps = useMemo(
    () => [...activities].sort((a, b) => b.created_at - a.created_at).slice(0, 20),
    [activities]
  )

  return (
    <div className="overflow-y-auto h-full">
      {/* Dispatch Form — Hero */}
      <div className="p-6 pb-0">
        <h2 className="font-heading text-xl font-semibold text-foreground mb-1">Operations Lab</h2>
        <p className="text-sm text-muted-foreground mb-4">Dispatch tasks, review outcomes, and monitor scheduled operations.</p>
        <DispatchForm />
      </div>

      {/* Review Queue + Schedules */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Review Queue */}
        <div className="desk-panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Review Queue</h3>
            <span className="text-2xs font-mono-tight text-muted-foreground">{reviewTasks.length} items</span>
          </div>
          <div className="panel-body p-0">
            {reviewTasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No tasks awaiting review.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {reviewTasks.slice(0, 10).map(task => (
                  <ReviewTaskRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Schedules */}
        <div className="desk-panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Schedules</h3>
            <span className="text-2xs font-mono-tight text-muted-foreground">{enabledCrons.length} active</span>
          </div>
          <div className="panel-body p-0">
            {enabledCrons.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No active schedules.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {enabledCrons.slice(0, 10).map(cron => (
                  <ScheduleRow key={cron.id || cron.name} cron={cron} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Operations Log */}
      <div className="px-6 pb-6">
        <div className="desk-panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Operations Log</h3>
            <span className="text-2xs font-mono-tight text-muted-foreground">Last {recentOps.length}</span>
          </div>
          <div className="panel-body p-0 max-h-[400px] overflow-y-auto">
            {recentOps.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No recent operations.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {recentOps.map(act => (
                  <OpsLogRow key={act.id} activity={act} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───

const priorityColors: Record<string, string> = {
  urgent: 'badge-error',
  critical: 'badge-error',
  high: 'badge-warning',
  medium: 'badge-neutral',
  low: 'badge-neutral',
}

function ReviewTaskRow({ task }: { task: Task }) {
  const timeStr = formatRelativeTime(task.updated_at * 1000)
  const statusLabel = task.status === 'quality_review' ? 'QA Review' : 'Review'

  return (
    <div className="px-4 py-3 hover:bg-secondary/30 transition-smooth">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground font-medium truncate">{task.title}</p>
          {task.assigned_to && (
            <p className="text-2xs text-muted-foreground mt-0.5">Assigned to {task.assigned_to}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-2xs px-2 py-0.5 rounded-full border ${priorityColors[task.priority] || 'badge-neutral'}`}>
            {task.priority}
          </span>
          <span className="text-2xs px-2 py-0.5 rounded-full badge-info">{statusLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-2xs text-muted-foreground">
        {task.ticket_ref && <span className="font-mono-tight">{task.ticket_ref}</span>}
        <span>Updated {timeStr}</span>
      </div>
    </div>
  )
}

function ScheduleRow({ cron }: { cron: CronJob }) {
  const nextRunStr = cron.nextRun ? formatRelativeTime(cron.nextRun * 1000) : '—'
  const lastRunStr = cron.lastRun ? formatRelativeTime(cron.lastRun * 1000) : 'never'

  const statusDot =
    cron.lastStatus === 'success' ? 'bg-success' :
    cron.lastStatus === 'error' ? 'bg-destructive' :
    cron.lastStatus === 'running' ? 'bg-warning pulse-dot' :
    'bg-muted-foreground/40'

  return (
    <div className="px-4 py-3 hover:bg-secondary/30 transition-smooth">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground font-medium truncate">{cron.name}</p>
          <p className="text-2xs text-muted-foreground font-mono-tight mt-0.5">{cron.schedule}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="text-2xs text-muted-foreground">{cron.lastStatus || 'idle'}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground">
        <span>Last: {lastRunStr}</span>
        <span>Next: {nextRunStr}</span>
      </div>
    </div>
  )
}

function OpsLogRow({ activity }: { activity: Activity }) {
  const timeStr = formatRelativeTime(activity.created_at * 1000)

  return (
    <div className="px-4 py-2.5 hover:bg-secondary/30 transition-smooth">
      <div className="flex items-start gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">{activity.description}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-2xs text-muted-foreground font-mono-tight">{activity.actor}</span>
            <span className="text-2xs text-muted-foreground/40">·</span>
            <span className="text-2xs text-muted-foreground">{timeStr}</span>
            {activity.entity_type && (
              <>
                <span className="text-2xs text-muted-foreground/40">·</span>
                <span className="text-2xs text-muted-foreground">{activity.entity_type}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) {
    // Future time (for nextRun)
    const absDiff = Math.abs(diff)
    if (absDiff < 60_000) return 'in <1m'
    if (absDiff < 3_600_000) return `in ${Math.floor(absDiff / 60_000)}m`
    if (absDiff < 86_400_000) return `in ${Math.floor(absDiff / 3_600_000)}h`
    return `in ${Math.floor(absDiff / 86_400_000)}d`
  }
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
