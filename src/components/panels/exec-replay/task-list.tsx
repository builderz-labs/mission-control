'use client'

import { Button } from '@/components/ui/button'
import { timeAgo } from './helpers'
import type { TaskSummary } from './types'

interface TaskListProps {
  tasks: TaskSummary[]
  loading: boolean
  error: string | null
  selectedTaskId: number | null
  onSelect: (taskId: number) => void
  onRefresh: () => void
}

export function TaskList({ tasks, loading, error, selectedTaskId, onSelect, onRefresh }: TaskListProps): React.JSX.Element {
  return (
    <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Tasks</h2>
        <Button size="xs" variant="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? '…' : '↺'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-3 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg shimmer" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="m-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">No tasks with traces found.</div>
        )}

        {!loading && tasks.map(task => (
          <button
            key={task.task_id}
            onClick={() => onSelect(task.task_id)}
            className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors hover:bg-secondary/60 ${selectedTaskId === task.task_id ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-foreground truncate flex-1">
                {`#${task.task_id}`}
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-secondary text-2xs text-muted-foreground font-mono shrink-0">
                {task.step_count}
              </span>
            </div>
            {task.session_id && (
              <p className="text-2xs text-muted-foreground font-mono truncate">{task.session_id}</p>
            )}
            <p className="text-2xs text-muted-foreground mt-0.5">{timeAgo(task.started_at)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
