'use client'

import { useState } from 'react'
import type { Agent } from '@/store'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { createClientLogger } from '@/lib/client-logger'
import type { Task, Project } from './types'
import { MentionTextarea, useMentionTargets } from './mention-textarea'

const log = createClientLogger('TaskBoard')

export interface CreateTaskModalProps {
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onCreated: () => void
}

export function CreateTaskModal({
  agents,
  projects,
  onClose,
  onCreated
}: CreateTaskModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    project_id: projects[0]?.id ? String(projects[0].id) : '',
    assigned_to: '',
    tags: '',
  })
  const mentionTargets = useMentionTargets()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) return

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          project_id: formData.project_id ? Number(formData.project_id) : undefined,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMsg = errorData.details ? errorData.details.join(', ') : errorData.error
        throw new Error(errorMsg)
      }

      onCreated()
      onClose()
    } catch (error) {
      log.error('Error creating task:', error)
    }
  }

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="bg-card border border-border rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 id="create-task-title" className="text-xl font-bold text-foreground mb-4">Create New Task</h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="create-title" className="block text-sm text-muted-foreground mb-1">Title</label>
              <input
                id="create-title"
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>

            <div>
              <label htmlFor="create-description" className="block text-sm text-muted-foreground mb-1">Description</label>
              <MentionTextarea
                id="create-description"
                value={formData.description}
                onChange={(next) => setFormData(prev => ({ ...prev, description: next }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                rows={3}
                mentionTargets={mentionTargets}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Tip: type <span className="font-mono">@</span> for mention autocomplete.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="create-priority" className="block text-sm text-muted-foreground mb-1">Priority</label>
                <select
                  id="create-priority"
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label htmlFor="create-project" className="block text-sm text-muted-foreground mb-1">Project</label>
                <select
                  id="create-project"
                  value={formData.project_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, project_id: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {projects.map(project => (
                    <option key={project.id} value={String(project.id)}>
                      {project.name} ({project.ticket_prefix})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="create-assignee" className="block text-sm text-muted-foreground mb-1">Assign to</label>
              <select
                id="create-assignee"
                value={formData.assigned_to}
                onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Unassigned</option>
                {agents.map(agent => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name} ({agent.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="create-tags" className="block text-sm text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
                id="create-tags"
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="frontend, urgent, bug"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
            >
              Create Task
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
