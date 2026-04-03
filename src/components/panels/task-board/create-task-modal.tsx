'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { createClientLogger } from '@/lib/client-logger'
import { MentionTextarea, useMentionTargets } from './mention-textarea'
import type { Task, Agent, Project } from './task-board-types'

const log = createClientLogger('CreateTaskModal')

interface CreateTaskModalProps {
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onCreated: () => void
}

interface ParsedSchedule {
  cronExpr: string
  humanReadable: string
}

/** Parses a natural-language schedule string via /api/schedule-parse. */
async function parseSchedule(value: string): Promise<ParsedSchedule | null> {
  try {
    const res = await fetch(
      `/api/schedule-parse?input=${encodeURIComponent(value.trim())}`,
      { signal: AbortSignal.timeout(8000) }
    )
    const data = await res.json()
    return data.cronExpr ? (data as ParsedSchedule) : null
  } catch {
    return null
  }
}

function RecurringScheduleField({
  isRecurring,
  onToggle,
  scheduleInput,
  onScheduleChange,
  parsedSchedule,
  scheduleError,
}: {
  isRecurring: boolean
  onToggle: (checked: boolean) => void
  scheduleInput: string
  onScheduleChange: (value: string) => void
  parsedSchedule: ParsedSchedule | null
  scheduleError: string
}) {
  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isRecurring}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-border"
        />
        <span className="text-sm text-foreground">Make recurring</span>
      </label>
      {isRecurring && (
        <div>
          <input
            type="text"
            value={scheduleInput}
            onChange={(e) => onScheduleChange(e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder='e.g. "every morning at 9am" or "every 2 hours"'
          />
          {parsedSchedule && (
            <p className="text-xs text-cyan-400 mt-1">
              {parsedSchedule.humanReadable}{' '}
              <span className="text-muted-foreground font-mono">({parsedSchedule.cronExpr})</span>
            </p>
          )}
          {scheduleError && (
            <p className="text-xs text-red-400 mt-1">
              {scheduleError}. Try: &quot;daily at 9am&quot;, &quot;every 2 hours&quot;, &quot;weekly on monday&quot;
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function CreateTaskModal({ agents, projects, onClose, onCreated }: CreateTaskModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    project_id: projects[0]?.id ? String(projects[0].id) : '',
    assigned_to: '',
    tags: '',
  })
  const [isRecurring, setIsRecurring] = useState(false)
  const [scheduleInput, setScheduleInput] = useState('')
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [scheduleError, setScheduleError] = useState('')
  const mentionTargets = useMentionTargets()
  const dialogRef = useFocusTrap(onClose)

  const handleScheduleChange = async (value: string) => {
    setScheduleInput(value)
    setScheduleError('')
    setParsedSchedule(null)
    if (!value.trim()) return
    const parsed = await parseSchedule(value)
    if (parsed) {
      setParsedSchedule(parsed)
    } else {
      setScheduleError('Could not parse schedule')
    }
  }

  const handleRecurringToggle = (checked: boolean) => {
    setIsRecurring(checked)
    if (!checked) {
      setParsedSchedule(null)
      setScheduleInput('')
      setScheduleError('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) return
    if (isRecurring && !parsedSchedule) return

    const metadata: Record<string, unknown> = {}
    if (isRecurring && parsedSchedule) {
      metadata.recurrence = {
        cron_expr: parsedSchedule.cronExpr,
        natural_text: parsedSchedule.humanReadable,
        enabled: true,
        last_spawned_at: null,
        spawn_count: 0,
        parent_task_id: null,
      }
    }

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          project_id: formData.project_id ? Number(formData.project_id) : undefined,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined,
          metadata,
        }),
        signal: AbortSignal.timeout(8000),
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

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
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
              <p className="text-[11px] text-muted-foreground mt-1">
                Tip: type <span className="font-mono">@</span> for mention autocomplete.
              </p>
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

            <RecurringScheduleField
              isRecurring={isRecurring}
              onToggle={handleRecurringToggle}
              scheduleInput={scheduleInput}
              onScheduleChange={handleScheduleChange}
              parsedSchedule={parsedSchedule}
              scheduleError={scheduleError}
            />
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit" className="flex-1" disabled={isRecurring && !parsedSchedule}>
              {isRecurring ? 'Create Recurring Task' : 'Create Task'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
