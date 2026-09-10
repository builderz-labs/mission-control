'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { FlyActivity, FlyActivityJob } from '@/lib/fly-activity'
import { flyJobBoardStatus } from '@/lib/fly-board-status'

export function TaskBoardFlyStrip({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const [activity, setActivity] = useState<FlyActivity | null>(null)
  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ activity?: FlyActivity }>('/api/fly/status', { signal: AbortSignal.timeout(8000) })
      if (data.activity) setActivity(data.activity)
    } catch {
      setActivity(null)
    }
  }, [])
  useSmartPoll(refresh, 5000, { pauseWhenSseConnected: false })
  useEffect(() => {
    const onFly = () => { void refresh() }
    window.addEventListener('mission-control:fly-worker-updated', onFly)
    return () => window.removeEventListener('mission-control:fly-worker-updated', onFly)
  }, [refresh])

  const jobs = activity?.jobs || []
  if (!activity || activity.submissions === 0) return null

  return (
    <section className="mx-4 mt-3 rounded-xl border border-border/60 bg-surface-0 px-4 py-3" aria-label="Fly workers">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Fly workers</span>
        <span>{activity.active_workers} active</span>
        <span>{activity.queued} queued</span>
        <span>{activity.submissions} launches</span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {jobs.slice(0, 12).map((job) => (
          <FlyJobCard key={job.id} job={job} onOpenTask={onOpenTask} />
        ))}
      </ul>
    </section>
  )
}

function FlyJobCard({ job, onOpenTask }: { job: FlyActivityJob; onOpenTask: (taskId: number) => void }) {
  const column = flyJobBoardStatus(job.state)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenTask(job.task_id)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-left text-xs hover:bg-secondary/40"
      >
        <span className="min-w-0 truncate font-medium text-foreground">{job.title}</span>
        <span className="shrink-0 font-mono text-muted-foreground">{job.state} · {column}</span>
      </button>
    </li>
  )
}
