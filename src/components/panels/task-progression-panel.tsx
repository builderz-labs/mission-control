'use client'

import { useMissionControl } from '@/store'
import { computeTaskProgress, formatTaskTimeRemaining, getTaskStartedAt } from '@/lib/task-progress'

export function TaskProgressionPanel() {
  const { selectedTask, agents } = useMissionControl()

  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  return (
    <aside className="h-full min-h-0 bg-card border border-border rounded-lg p-5 flex flex-col overflow-y-auto">
      <h3 className="text-lg font-bold text-foreground mb-5 border-b border-border pb-3">Task Progression</h3>

      {!selectedTask && (
        <div className="bg-surface-1/40 p-4 rounded-xl border border-border text-sm text-muted-foreground">
          Click any task card on the left pane to see progression details.
        </div>
      )}

      {selectedTask && (
        <div className="bg-surface-1/40 p-4 rounded-xl border border-border">
          <div className="text-sm font-semibold text-foreground mb-1">{selectedTask.title}</div>
          <div className="text-xs text-muted-foreground mb-4">
            {selectedTask.status.replace('_', ' ')} | {getAgentName(selectedTask.assigned_to)}
          </div>

          <ol className="space-y-4 text-sm">
            <li>
              <div className="text-muted-foreground mb-1">1. Task progression</div>
              <div className="w-full bg-background rounded-full h-2 border border-border overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yellow-500 to-orange-400 transition-all duration-500"
                  style={{ width: `${computeTaskProgress(selectedTask)}%` }}
                />
              </div>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted-foreground">2. %</span>
              <span className="text-xl font-bold text-yellow-400">{computeTaskProgress(selectedTask)}%</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted-foreground">3. Time remaining</span>
              <span className="font-semibold text-foreground">{formatTaskTimeRemaining(selectedTask)}</span>
            </li>
            <li className="flex justify-between items-center">
              <span className="text-muted-foreground">4. Started</span>
              <span className="font-semibold text-foreground">{new Date(getTaskStartedAt(selectedTask) * 1000).toLocaleString()}</span>
            </li>
          </ol>
        </div>
      )}
    </aside>
  )
}
