'use client'

import { useMemo } from 'react'
import { useMissionControl, type Task, type Activity, type CronJob } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { DispatchForm } from '@/components/dispatch-form'

/**
 * LabPage — the operational workspace.
 *
 * When empty: onboarding guidance, not a blank void.
 * When active: dispatch form hero, review queue, schedules, ops log.
 *
 * Language: operational, not developer.
 * "Dispatch an instruction" not "Create a task"
 * "Review Queue" not "Quality Review Pipeline"
 */
export function LabPage() {
  const { tasks, activities, cronJobs, agents } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()

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

  const hasAnyData = tasks.length > 0 || activities.length > 0 || cronJobs.length > 0

  return (
    <div className="overflow-y-auto h-full">
      {/* Dispatch Form — Hero */}
      <div className="p-6 pb-0">
        <h2 className="font-heading text-xl font-semibold text-foreground mb-1">Operations Lab</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Tell your agents what to do. They&apos;ll figure out who handles it.
        </p>
        <DispatchForm />
      </div>

      {/* Onboarding guidance when the Lab is empty */}
      {!hasAnyData && (
        <div className="p-6">
          <div className="desk-panel p-6 border-l-4 border-l-primary">
            <h3 className="text-base font-semibold text-foreground mb-3">Getting Started</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The Lab is where you give instructions and review results. Here&apos;s how to get moving:
            </p>
            <div className="space-y-3">
              <GuidanceRow
                number="1"
                title="Dispatch your first instruction"
                description="Use the form above to tell JARVIS what you need. Be specific — 'Summarize yesterday's commits in OneKeel repos' works better than 'check GitHub'."
              />
              <GuidanceRow
                number="2"
                title="Check the Bridge"
                description="The Bridge tab shows your full agent squad. Each card tells you what that agent does, what it last did, and how to use it."
                action="Go to Bridge"
                onAction={() => {
                  const { setActiveTab } = useMissionControl.getState()
                  setActiveTab('overview')
                }}
              />
              <GuidanceRow
                number="3"
                title="Review results here"
                description="When agents complete work, items that need your sign-off appear in the Review Queue below. Schedules show automated runs."
              />
            </div>
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Tip:</strong> Press <kbd className="px-1.5 py-0.5 rounded bg-secondary text-2xs font-mono-tight border border-border/50">Cmd+Enter</kbd> to dispatch quickly from the text area.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Review Queue + Schedules */}
      {hasAnyData && (
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Review Queue */}
          <div className="desk-panel overflow-hidden">
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">Review Queue</h3>
              <span className="text-2xs font-mono-tight text-muted-foreground">{reviewTasks.length} items</span>
            </div>
            <div className="panel-body p-0">
              {reviewTasks.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-muted-foreground">Nothing waiting for your review.</p>
                  <p className="text-2xs text-muted-foreground mt-1">
                    When agents finish work that needs your sign-off, it shows up here.
                  </p>
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
              <h3 className="text-sm font-semibold text-foreground">Scheduled Runs</h3>
              <span className="text-2xs font-mono-tight text-muted-foreground">{enabledCrons.length} active</span>
            </div>
            <div className="panel-body p-0">
              {enabledCrons.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-muted-foreground">No scheduled runs yet.</p>
                  <p className="text-2xs text-muted-foreground mt-1">
                    Cron jobs like morning briefs and engineering summaries will appear here once configured.
                  </p>
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
      )}

      {/* Operations Log */}
      {recentOps.length > 0 && (
        <div className="px-6 pb-6">
          <div className="desk-panel overflow-hidden">
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">Operations Log</h3>
              <span className="text-2xs font-mono-tight text-muted-foreground">Last {recentOps.length}</span>
            </div>
            <div className="panel-body p-0 max-h-[400px] overflow-y-auto">
              <div className="divide-y divide-border/40">
                {recentOps.map(act => (
                  <OpsLogRow key={act.id} activity={act} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Guidance Row (onboarding) ───

function GuidanceRow({
  number,
  title,
  description,
  action,
  onAction,
}: {
  number: string
  title: string
  description: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
        {number}
      </span>
      <div>
        <p className="text-sm text-foreground font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        {action && onAction && (
          <button
            onClick={onAction}
            className="text-xs text-primary font-medium mt-1 hover:underline"
          >
            {action} →
          </button>
        )}
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
    <div className="px-4 py-3 hover:bg-secondary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground font-medium truncate">{task.title}</p>
          {task.assigned_to && (
            <p className="text-2xs text-muted-foreground mt-0.5">From {task.assigned_to}</p>
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
    'bg-muted-foreground/30'

  return (
    <div className="px-4 py-3 hover:bg-secondary/30 transition-colors">
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
    <div className="px-4 py-2.5 hover:bg-secondary/30 transition-colors">
      <div className="flex items-start gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">{activity.description}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
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
