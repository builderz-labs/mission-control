'use client'

import { useState, useEffect } from 'react'
import { type Agent } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import Link from 'next/link'

const log = createClientLogger('TasksTab')

export function TasksTab({ agent }: { agent: Agent }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await fetch(`/api/tasks?assigned_to=${agent.name}`)
        if (response.ok) {
          const data = await response.json()
          setTasks(data.tasks || [])
        }
      } catch (error) {
        log.error('Failed to fetch tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTasks()
  }, [agent.name])

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-2 text-muted-foreground">Loading tasks...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-medium text-foreground">Assigned Tasks</h4>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
          <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="2" width="10" height="12" rx="1" />
              <path d="M6 6h4M6 9h3" />
            </svg>
          </div>
          <p className="text-sm">No tasks assigned</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="bg-surface-1/50 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/tasks?taskId=${task.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                    {task.title}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-1">
                    {task.ticket_ref || `Task #${task.id}`}
                    {task.project_name ? ` · ${task.project_name}` : ''}
                  </div>
                  {task.description && (
                    <p className="text-foreground/80 text-sm mt-1">{task.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                    task.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    task.status === 'done' ? 'bg-green-500/20 text-green-400' :
                    task.status === 'review' ? 'bg-blue-500/20 text-blue-400' :
                    task.status === 'quality_review' ? 'bg-indigo-500/20 text-indigo-400' :
                    'bg-secondary text-muted-foreground'
                  }`}>
                    {task.status}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${
                    task.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                    task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-secondary text-muted-foreground'
                  }`}>
                    {task.priority}
                  </span>
                </div>
              </div>

              {task.due_date && (
                <div className="text-xs text-muted-foreground mt-2">
                  Due: {new Date(task.due_date * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
