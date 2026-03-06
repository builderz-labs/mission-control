'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

import { createClientLogger } from '@/lib/client-logger'

import { useFocusTrap } from '@/lib/use-focus-trap'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import { MarkdownRenderer } from '@/components/markdown-renderer'

const log = createClientLogger('TaskBoard')

interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
  aegisApproved?: boolean
  project_id?: number
  project_ticket_no?: number
  project_name?: string
  project_prefix?: string
  ticket_ref?: string
}

interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
}

interface Project {
  id: number
  name: string
  slug: string
  ticket_prefix: string
  status: 'active' | 'archived'
}

interface MentionOption {
  handle: string
  recipient: string
  type: 'user' | 'agent'
  display: string
  role?: string
}

const statusColumns = [
  { key: 'inbox', title: 'Inbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'done', title: 'Done', color: 'bg-green-500/20 text-green-400' },
]

const priorityColors: Record<string, string> = {
  low: 'border-green-500',
  medium: 'border-yellow-500',
  high: 'border-orange-500',
  critical: 'border-red-500',
}

function useMentionTargets() {
  const [mentionTargets, setMentionTargets] = useState<MentionOption[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const response = await fetch('/api/mentions?limit=200')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) setMentionTargets(data.mentions || [])
      } catch {
        // mention autocomplete is non-critical
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  return mentionTargets
}

function MentionTextarea({
  id,
  value,
  onChange,
  rows = 3,
  placeholder,
  className,
  mentionTargets,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
  className?: string
  mentionTargets: MentionOption[]
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [openUpwards, setOpenUpwards] = useState(false)

  const filtered = mentionTargets
    .filter((target) => {
      if (!query) return true
      const q = query.toLowerCase()
      return target.handle.includes(q) || target.display.toLowerCase().includes(q)
    })
    .slice(0, 8)

  const detectMentionQuery = (nextValue: string, caret: number) => {
    const left = nextValue.slice(0, caret)
    const match = left.match(/(?:^|[^\w.-])@([A-Za-z0-9._-]{0,63})$/)
    if (!match) {
      setOpen(false)
      setQuery('')
      setRange(null)
      return
    }
    const matched = match[1] || ''
    const start = caret - matched.length - 1
    setQuery(matched)
    setRange({ start, end: caret })
    setActiveIndex(0)
    setOpen(true)
  }

  const insertMention = (option: MentionOption) => {
    if (!range) return
    const next = `${value.slice(0, range.start)}@${option.handle} ${value.slice(range.end)}`
    onChange(next)
    setOpen(false)
    setQuery('')
    const cursor = range.start + option.handle.length + 2
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
    })
  }

  useEffect(() => {
    if (!open) return
    const node = textareaRef.current
    if (!node) return

    const rect = node.getBoundingClientRect()
    const estimatedMenuHeight = Math.min(Math.max(filtered.length, 1) * 46 + 12, 224)
    const availableBelow = window.innerHeight - rect.bottom
    const availableAbove = rect.top
    setOpenUpwards(availableBelow < estimatedMenuHeight && availableAbove > availableBelow)
  }, [open, filtered.length])

  return (
    <div className="relative">
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          const nextValue = e.target.value
          onChange(nextValue)
          detectMentionQuery(nextValue, e.target.selectionStart || 0)
        }}
        onClick={(e) => detectMentionQuery(value, (e.target as HTMLTextAreaElement).selectionStart || 0)}
        onKeyUp={(e) => detectMentionQuery(value, (e.target as HTMLTextAreaElement).selectionStart || 0)}
        onKeyDown={(e) => {
          if (!open || filtered.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((prev) => (prev + 1) % filtered.length)
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            insertMention(filtered[activeIndex])
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className={`absolute z-[60] w-full bg-surface-1 border border-border rounded-md shadow-xl max-h-56 overflow-y-auto ${
          openUpwards ? 'bottom-full mb-1' : 'mt-1'
        }`}>
          {filtered.map((option, index) => (
            <button
              key={`${option.type}-${option.handle}-${option.recipient}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(option)
              }}
              className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 border-border/40 ${
                index === activeIndex ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-surface-2'
              }`}
            >
              <div className="font-mono">@{option.handle}</div>
              <div className="text-muted-foreground">
                {option.display} • {option.type}{option.role ? ` • ${option.role}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskBoardPanel() {
  const { tasks: storeTasks, setTasks: storeSetTasks, selectedTask, setSelectedTask } = useMissionControl()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aegisMap, setAegisMap] = useState<Record<number, boolean>>({})
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const dragCounter = useRef(0)
  const selectedTaskIdFromUrl = Number.parseInt(searchParams.get('taskId') || '', 10)

  const updateTaskUrl = useCallback((taskId: number | null, mode: 'push' | 'replace' = 'push') => {
    const params = new URLSearchParams(searchParams.toString())
    if (typeof taskId === 'number' && Number.isFinite(taskId)) {
      params.set('taskId', String(taskId))
    } else {
      params.delete('taskId')
    }
    const query = params.toString()
    const href = query ? `${pathname}?${query}` : pathname
    if (mode === 'replace') {
      router.replace(href)
      return
    }
    router.push(href)
  }, [pathname, router, searchParams])

  // Augment store tasks with aegisApproved flag (computed, not stored)
  const tasks: Task[] = storeTasks.map(t => ({
    ...t,
    aegisApproved: Boolean(aegisMap[t.id])
  }))

  // Fetch tasks, agents, and projects
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const tasksQuery = new URLSearchParams()
      if (projectFilter !== 'all') {
        tasksQuery.set('project_id', projectFilter)
      }
      const tasksUrl = tasksQuery.toString() ? `/api/tasks?${tasksQuery.toString()}` : '/api/tasks'

      const [tasksResponse, agentsResponse, projectsResponse] = await Promise.all([
        fetch(tasksUrl),
        fetch('/api/agents'),
        fetch('/api/projects')
      ])

      if (!tasksResponse.ok || !agentsResponse.ok || !projectsResponse.ok) {
        throw new Error('Failed to fetch data')
      }

      const tasksData = await tasksResponse.json()
      const agentsData = await agentsResponse.json()
      const projectsData = await projectsResponse.json()

      const tasksList = tasksData.tasks || []
      const taskIds = tasksList.map((task: Task) => task.id)

      let newAegisMap: Record<number, boolean> = {}
      if (taskIds.length > 0) {
        try {
          const reviewResponse = await fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          if (reviewResponse.ok) {
            const reviewData = await reviewResponse.json()
            const latest = reviewData.latest || {}
            newAegisMap = Object.fromEntries(
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved'
              ])
            )
          }
        } catch {
          newAegisMap = {}
        }
      }

      storeSetTasks(tasksList)
      setAegisMap(newAegisMap)
      setAgents(agentsData.agents || [])
      setProjects(projectsData.projects || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [projectFilter, storeSetTasks])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!Number.isFinite(selectedTaskIdFromUrl)) {
      if (selectedTask) setSelectedTask(null)
      return
    }

    const match = tasks.find((task) => task.id === selectedTaskIdFromUrl)
    if (match) {
      if (selectedTask?.id !== match.id) {
        setSelectedTask(match)
      }
      return
    }

    if (!loading) {
      setError(`Task #${selectedTaskIdFromUrl} not found in current workspace`)
      setSelectedTask(null)
    }
  }, [loading, selectedTask, selectedTaskIdFromUrl, setSelectedTask, tasks])

  // Poll as SSE fallback — pauses when SSE is delivering events
  useSmartPoll(fetchData, 30000, { pauseWhenSseConnected: true })

  // Group tasks by status
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>)

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML)
  }

  const handleDragEnter = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    dragCounter.current++
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    dragCounter.current--
    if (dragCounter.current === 0) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const { updateTask } = useMissionControl()

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    dragCounter.current = 0
    e.currentTarget.classList.remove('drag-over')

    if (!draggedTask || draggedTask.status === newStatus) {
      setDraggedTask(null)
      return
    }

    const previousStatus = draggedTask.status

    try {
      if (newStatus === 'done') {
        const reviewResponse = await fetch(`/api/quality-review?taskId=${draggedTask.id}`)
        if (!reviewResponse.ok) {
          throw new Error('Unable to verify Aegis approval')
        }
        const reviewData = await reviewResponse.json()
        const latest = reviewData.reviews?.find((review: any) => review.reviewer === 'aegis')
        if (!latest || latest.status !== 'approved') {
          throw new Error('Aegis approval is required before moving to done')
        }
      }

      // Optimistically update via Zustand store
      updateTask(draggedTask.id, {
        status: newStatus as Task['status'],
        updated_at: Math.floor(Date.now() / 1000)
      })

      // Update on server
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [{ id: draggedTask.id, status: newStatus }]
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update task status')
      }
    } catch (err) {
      // Revert optimistic update via Zustand store
      updateTask(draggedTask.id, { status: previousStatus })
      setError(err instanceof Error ? err.message : 'Failed to update task status')
    } finally {
      setDraggedTask(null)
    }
  }

  // Format relative time for tasks
  const formatTaskTimestamp = (timestamp: number) => {
    const now = new Date().getTime()
    const time = new Date(timestamp * 1000).getTime()
    const diff = now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'just now'
  }

  const getTagColor = (tag: string) => {
    const lowerTag = tag.toLowerCase()
    if (lowerTag.includes('urgent') || lowerTag.includes('critical')) {
      return 'bg-red-500/20 text-red-400 border-red-500/30'
    }
    if (lowerTag.includes('bug') || lowerTag.includes('fix')) {
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    }
    if (lowerTag.includes('feature') || lowerTag.includes('enhancement')) {
      return 'bg-green-500/20 text-green-400 border-green-500/30'
    }
    if (lowerTag.includes('research') || lowerTag.includes('analysis')) {
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    }
    if (lowerTag.includes('deploy') || lowerTag.includes('release')) {
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    }
    return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
  }

  // Get agent name by session key
  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" aria-hidden="true"></div>
        <span className="ml-2 text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">Task Board</h2>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 px-3 bg-surface-1 text-foreground border border-border rounded-md text-sm"
          >
            <option value="all">All Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={String(project.id)}>
                {project.name} ({project.ticket_prefix})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowProjectManager(true)}
            className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth text-sm font-medium"
          >
            Projects
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-sm font-medium"
          >
            + New Task
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-2"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto" role="region" aria-label="Task board">
        {statusColumns.map(column => (
          <div
            key={column.key}
            role="region"
            aria-label={`${column.title} column, ${tasksByStatus[column.key]?.length || 0} tasks`}
            className="flex-1 min-w-80 bg-card border border-border rounded-lg flex flex-col"
            onDragEnter={(e) => handleDragEnter(e, column.key)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.key)}
          >
            {/* Column Header */}
            <div className={`${column.color} p-3 rounded-t-lg flex justify-between items-center`}>
              <h3 className="font-semibold">{column.title}</h3>
              <span className="text-sm bg-black/20 px-2 py-1 rounded">
                {tasksByStatus[column.key]?.length || 0}
              </span>
            </div>

            {/* Column Body */}
            <div className="flex-1 p-3 space-y-3 min-h-32">
              {tasksByStatus[column.key]?.map(task => (
                <div
                  key={task.id}
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`${task.title}, ${task.priority} priority, ${task.status}`}
                  onDragStart={(e) => handleDragStart(e, task)}
                  onClick={() => {
                    setSelectedTask(task)
                    updateTaskUrl(task.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedTask(task)
                      updateTaskUrl(task.id)
                    }
                  }}
                  className={`bg-surface-1 rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-smooth border-l-4 ${priorityColors[task.priority]} ${
                    draggedTask?.id === task.id ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-foreground font-medium text-sm leading-tight">
                      {task.title}
                    </h4>
                    <div className="flex items-center gap-2">
                      {task.ticket_ref && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary">
                          {task.ticket_ref}
                        </span>
                      )}
                      {task.aegisApproved && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">
                          Aegis Approved
                        </span>
                      )}
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        task.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                        task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                        task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>
                        {task.priority}
                      </span>
                    </div>
                  </div>
                  
                  {task.description && (
                    <div className="mb-2 line-clamp-3 overflow-hidden">
                      <MarkdownRenderer content={task.description} preview />
                    </div>
                  )}

                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {task.assigned_to ? (
                        <>
                          <AgentAvatar name={getAgentName(task.assigned_to)} size="xs" />
                          <span className="truncate">{getAgentName(task.assigned_to)}</span>
                        </>
                      ) : (
                        <span>Unassigned</span>
                      )}
                    </span>
                    <span className="font-medium">{formatTaskTimestamp(task.created_at)}</span>
                  </div>

                  {task.project_name && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Project: {task.project_name}
                    </div>
                  )}

                  {task.tags && task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.tags.slice(0, 3).map((tag, index) => (
                        <span
                          key={index}
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="text-muted-foreground text-xs font-medium">+{task.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Enhanced timestamp display */}
                  {task.updated_at && task.updated_at !== task.created_at && (
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      Updated {formatTaskTimestamp(task.updated_at)}
                    </div>
                  )}

                  {task.due_date && (
                    <div className="mt-2 text-xs">
                      <span className={`${
                        task.due_date * 1000 < Date.now() ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        Due: {formatTaskTimestamp(task.due_date)}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Empty State */}
              {tasksByStatus[column.key]?.length === 0 && (
                <div className="text-center text-muted-foreground/50 py-8 text-sm">
                  No tasks in {column.title.toLowerCase()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && !editingTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          projects={projects}
          onClose={() => {
            setSelectedTask(null)
            updateTaskUrl(null)
          }}
          onUpdate={fetchData}
          onEdit={(taskToEdit) => {
            setEditingTask(taskToEdit)
            setSelectedTask(null)
            updateTaskUrl(null, 'replace')
          }}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          agents={agents}
          projects={projects}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchData}
        />
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          agents={agents}
          projects={projects}
          onClose={() => setEditingTask(null)}
          onUpdated={() => { fetchData(); setEditingTask(null) }}
        />
      )}

      {showProjectManager && (
        <ProjectManagerModal
          onClose={() => setShowProjectManager(false)}
          onChanged={fetchData}
        />
      )}
    </div>
  )
}

// Task Detail Modal Component (placeholder - would be implemented separately)
function TaskDetailModal({
  task,
  agents,
  projects,
  onClose,
  onUpdate,
  onEdit
}: {
  task: Task
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onUpdate: () => void
  onEdit: (task: Task) => void
}) {
  const { currentUser } = useMissionControl()
  const commentAuthor = currentUser?.username || 'system'
  const resolvedProjectName =
    task.project_name ||
    projects.find((project) => project.id === task.project_id)?.name
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const mentionTargets = useMentionTargets()
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality'>('details')
  const [reviewer, setReviewer] = useState('aegis')

  const fetchReviews = useCallback(async () => {
    try {
      const response = await fetch(`/api/quality-review?taskId=${task.id}`)
      if (!response.ok) throw new Error('Failed to fetch reviews')
      const data = await response.json()
      setReviews(data.reviews || [])
    } catch (error) {
      setReviewError('Failed to load quality reviews')
    }
  }, [task.id])

  const fetchComments = useCallback(async () => {
    try {
      setLoadingComments(true)
      const response = await fetch(`/api/tasks/${task.id}/comments`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      setComments(data.comments || [])
    } catch (error) {
      setCommentError('Failed to load comments')
    } finally {
      setLoadingComments(false)
    }
  }, [task.id])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])
  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])
  
  useSmartPoll(fetchComments, 15000)

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return

    try {
      setCommentError(null)
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          content: commentText
        })
      })
      if (!response.ok) throw new Error('Failed to add comment')
      setCommentText('')
      await fetchComments()
      onUpdate()
    } catch (error) {
      setCommentError('Failed to add comment')
    }
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastMessage.trim()) return

    try {
      setBroadcastStatus(null)
      const response = await fetch(`/api/tasks/${task.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          message: broadcastMessage
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Broadcast failed')
      setBroadcastMessage('')
      setBroadcastStatus(`Sent to ${data.sent || 0} subscribers`)
    } catch (error) {
      setBroadcastStatus('Failed to broadcast')
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setReviewError(null)
      const response = await fetch('/api/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          reviewer,
          status: reviewStatus,
          notes: reviewNotes
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit review')
      setReviewNotes('')
      await fetchReviews()
      onUpdate()
    } catch (error) {
      setReviewError('Failed to submit review')
    }
  }

  const renderComment = (comment: Comment, depth: number = 0) => (
    <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{comment.author}</span>
        <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
      </div>
      <div className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{comment.content}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  )

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 id="task-detail-title" className="text-xl font-bold text-foreground">{task.title}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(task)}
                className="px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded-md transition-smooth text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={onClose}
                aria-label="Close task details"
                className="text-muted-foreground hover:text-foreground text-2xl transition-smooth"
              >
                ×
              </button>
            </div>
          </div>
          {task.description ? (
            <div className="mb-4">
              <MarkdownRenderer content={task.description} />
            </div>
          ) : (
            <p className="text-foreground/80 mb-4">No description</p>
          )}
          <div className="flex gap-2 mt-4" role="tablist" aria-label="Task detail tabs">
            {(['details', 'comments', 'quality'] as const).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`tabpanel-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm rounded-md transition-smooth ${
                  activeTab === tab ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'
                }`}
              >
                {tab === 'details' ? 'Details' : tab === 'comments' ? 'Comments' : 'Quality Review'}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div id="tabpanel-details" role="tabpanel" aria-label="Details" className="grid grid-cols-2 gap-4 text-sm mt-4">
              {task.ticket_ref && (
                <div>
                  <span className="text-muted-foreground">Ticket:</span>
                  <span className="text-foreground ml-2 font-mono">{task.ticket_ref}</span>
                </div>
              )}
              {resolvedProjectName && (
                <div>
                  <span className="text-muted-foreground">Project:</span>
                  <span className="text-foreground ml-2">{resolvedProjectName}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Status:</span>
                <span className="text-foreground ml-2">{task.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Priority:</span>
                <span className="text-foreground ml-2">{task.priority}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Assigned to:</span>
                <span className="text-foreground ml-2 inline-flex items-center gap-1.5">
                  {task.assigned_to ? (
                    <>
                      <AgentAvatar name={task.assigned_to} size="xs" />
                      <span>{task.assigned_to}</span>
                    </>
                  ) : (
                    <span>Unassigned</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <span className="text-foreground ml-2">{new Date(task.created_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div id="tabpanel-comments" role="tabpanel" aria-label="Comments" className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-foreground">Comments</h4>
              <button
                onClick={fetchComments}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Refresh
              </button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-sm mb-3">
                {commentError}
              </div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-sm">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/50 text-sm">No comments yet.</div>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Posting as</span>
                <span className="font-medium text-foreground">{commentAuthor}</span>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">New Comment</label>
                <MentionTextarea
                  value={commentText}
                  onChange={setCommentText}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={3}
                  mentionTargets={mentionTargets}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Use <span className="font-mono">@</span> to mention users and agents.</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-sm"
                >
                  Add Comment
                </button>
              </div>
            </form>

            <div className="mt-5 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-blue-300">How notifications work</div>
              <div><strong className="text-foreground">Comments</strong> are persisted on the task and notify all subscribers. Subscribers are auto-added when they: create the task, are assigned to it, comment on it, or are @mentioned.</div>
              <div><strong className="text-foreground">Broadcasts</strong> send a one-time notification to all current subscribers without creating a comment record.</div>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Broadcast to Subscribers</h5>
              {broadcastStatus && (
                <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <MentionTextarea
                  value={broadcastMessage}
                  onChange={setBroadcastMessage}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={2}
                  placeholder="Send a message to all task subscribers... (use @ to mention)"
                  mentionTargets={mentionTargets}
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-md hover:bg-purple-500/30 transition-smooth text-xs"
                  >
                    Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>
          )}

          {activeTab === 'quality' && (
            <div id="tabpanel-quality" role="tabpanel" aria-label="Quality Review" className="mt-6">
              <h5 className="text-sm font-medium text-foreground mb-2">Aegis Quality Review</h5>
              {reviewError && (
                <div className="text-xs text-red-400 mb-2">{reviewError}</div>
              )}
              {reviews.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {reviews.map((review) => (
                    <div key={review.id} className="text-xs text-foreground/80 bg-surface-1/40 rounded p-2">
                      <div className="flex justify-between">
                        <span>{review.reviewer} — {review.status}</span>
                        <span>{new Date(review.created_at * 1000).toLocaleString()}</span>
                      </div>
                      {review.notes && <div className="mt-1">{review.notes}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mb-3">No reviews yet.</div>
              )}
              <form onSubmit={handleSubmitReview} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Reviewer (e.g., aegis)"
                  />
                  <select
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value as 'approved' | 'rejected')}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                  >
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                  </select>
                  <input
                    type="text"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Review notes (required)"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md text-xs"
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Create Task Modal Component (placeholder)
function CreateTaskModal({ 
  agents, 
  projects,
  onClose, 
  onCreated 
}: { 
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onCreated: () => void
}) {
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

// Edit Task Modal Component
function EditTaskModal({
  task,
  agents,
  projects,
  onClose,
  onUpdated
}: {
  task: Task
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onUpdated: () => void
}) {
  const [formData, setFormData] = useState({
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    status: task.status,
    project_id: task.project_id ? String(task.project_id) : (projects[0]?.id ? String(projects[0].id) : ''),
    assigned_to: task.assigned_to || '',
    tags: task.tags ? task.tags.join(', ') : '',
  })
  const mentionTargets = useMentionTargets()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) return

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
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

      onUpdated()
    } catch (error) {
      log.error('Error updating task:', error)
    }
  }

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-task-title" className="bg-card border border-border rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 id="edit-task-title" className="text-xl font-bold text-foreground mb-4">Edit Task</h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="edit-title" className="block text-sm text-muted-foreground mb-1">Title</label>
              <input
                id="edit-title"
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>

            <div>
              <label htmlFor="edit-description" className="block text-sm text-muted-foreground mb-1">Description</label>
              <MentionTextarea
                id="edit-description"
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
                <label htmlFor="edit-status" className="block text-sm text-muted-foreground mb-1">Status</label>
                <select
                  id="edit-status"
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as Task['status'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="inbox">Inbox</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="quality_review">Quality Review</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-priority" className="block text-sm text-muted-foreground mb-1">Priority</label>
                <select
                  id="edit-priority"
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
            </div>

            <div>
              <label htmlFor="edit-project" className="block text-sm text-muted-foreground mb-1">Project</label>
              <select
                id="edit-project"
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

            <div>
              <label htmlFor="edit-assignee" className="block text-sm text-muted-foreground mb-1">Assign to</label>
              <select
                id="edit-assignee"
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
              <label htmlFor="edit-tags" className="block text-sm text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
                id="edit-tags"
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
              Save Changes
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

function ProjectManagerModal({
  onClose,
  onChanged
}: {
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', ticket_prefix: '', description: '' })

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/projects?includeArchived=1')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load projects')
      setProjects(data.projects || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          ticket_prefix: form.ticket_prefix,
          description: form.description
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create project')
      setForm({ name: '', ticket_prefix: '', description: '' })
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  const archiveProject = async (project: Project) => {
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: project.status === 'active' ? 'archived' : 'active' })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update project')
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project')
    }
  }

  const deleteProject = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? Existing tasks will be moved to General.`)) return
    try {
      const response = await fetch(`/api/projects/${project.id}?mode=delete`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to delete project')
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const dialogRef = useFocusTrap(onClose)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="projects-title" className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 id="projects-title" className="text-xl font-bold text-foreground">Project Management</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl">×</button>
          </div>

          {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">{error}</div>}

          <form onSubmit={createProject} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Project name"
              className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
              required
            />
            <input
              type="text"
              value={form.ticket_prefix}
              onChange={(e) => setForm((prev) => ({ ...prev, ticket_prefix: e.target.value }))}
              placeholder="Ticket prefix (e.g. PA)"
              className="bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
            />
            <button type="submit" className="bg-primary text-primary-foreground rounded-md px-3 py-2 hover:bg-primary/90">
              Add Project
            </button>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Description (optional)"
              className="md:col-span-3 bg-surface-1 text-foreground border border-border rounded-md px-3 py-2"
            />
          </form>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div key={project.id} className="flex items-center justify-between border border-border rounded-md p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{project.name}</div>
                    <div className="text-xs text-muted-foreground">{project.ticket_prefix} · {project.slug} · {project.status}</div>
                  </div>
                  <div className="flex gap-2">
                    {project.slug !== 'general' && (
                      <>
                        <button
                          onClick={() => archiveProject(project)}
                          className="px-3 py-1 text-xs rounded border border-border hover:bg-secondary"
                        >
                          {project.status === 'active' ? 'Archive' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteProject(project)}
                          className="px-3 py-1 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
