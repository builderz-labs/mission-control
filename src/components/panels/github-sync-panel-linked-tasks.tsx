'use client'

import type { LinkedTask } from './github-sync-panel-types'

interface LinkedTasksTableProps {
  tasks: LinkedTask[]
}

export function LinkedTasksTable({ tasks }: LinkedTasksTableProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">
          Linked Tasks{tasks.length > 0 ? ` (${tasks.length})` : ''}
        </h3>
      </div>
      {tasks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Task</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Priority</th>
                <th className="text-left px-4 py-2 font-medium">GitHub</th>
                <th className="text-left px-4 py-2 font-medium">Synced</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <LinkedTaskRow key={task.id} task={task} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No tasks linked to GitHub issues yet.
        </div>
      )}
    </div>
  )
}

const PRIORITY_CLASSES: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400',
  high: 'bg-orange-500/10 text-orange-400',
  low: 'bg-blue-500/10 text-blue-400',
}

function priorityClass(priority: string): string {
  return PRIORITY_CLASSES[priority] ?? 'bg-secondary text-muted-foreground'
}

interface LinkedTaskRowProps {
  task: LinkedTask
}

function LinkedTaskRow({ task }: LinkedTaskRowProps): React.JSX.Element {
  return (
    <tr className="border-b border-border/50 hover:bg-secondary/50">
      <td className="px-4 py-2 text-foreground max-w-[250px] truncate">{task.title}</td>
      <td className="px-4 py-2">
        <span className="px-1.5 py-0.5 rounded text-2xs bg-secondary text-muted-foreground">
          {task.status}
        </span>
      </td>
      <td className="px-4 py-2">
        <span className={`px-1.5 py-0.5 rounded text-2xs ${priorityClass(task.priority)}`}>
          {task.priority}
        </span>
      </td>
      <td className="px-4 py-2">
        {task.metadata.github_issue_url ? (
          <a
            href={task.metadata.github_issue_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-mono"
          >
            {task.metadata.github_repo}#{task.metadata.github_issue_number}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-muted-foreground">
        {task.metadata.github_synced_at
          ? new Date(task.metadata.github_synced_at).toLocaleDateString()
          : '—'}
      </td>
    </tr>
  )
}
