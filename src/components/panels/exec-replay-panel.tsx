'use client'

// Thin shell — manages task selection and delegates all rendering to sub-components.
// Sub-components live in ./exec-replay/

import { useState, useEffect, useCallback } from 'react'
import { getErrorMessage } from '@/lib/types/sql'
import { TaskList } from './exec-replay/task-list'
import { TracePlayer } from './exec-replay/trace-player'
import type { TaskSummary } from './exec-replay/types'

export function ExecReplayPanel(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const fetchTasks = useCallback(async (): Promise<void> => {
    setTasksLoading(true)
    setTasksError(null)
    try {
      const res = await fetch('/api/exec-replay/tasks', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTasks(json.data ?? [])
    } catch (err: unknown) {
      setTasksError(getErrorMessage(err))
    } finally {
      setTasksLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  return (
    <div className="flex h-full overflow-hidden">
      <TaskList
        tasks={tasks}
        loading={tasksLoading}
        error={tasksError}
        selectedTaskId={selectedTaskId}
        onSelect={setSelectedTaskId}
        onRefresh={fetchTasks}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTaskId === null ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a task from the list to begin replay</p>
          </div>
        ) : (
          // Key on taskId so TracePlayer fully re-mounts when the selection changes
          <TracePlayer key={selectedTaskId} taskId={selectedTaskId} />
        )}
      </div>
    </div>
  )
}
