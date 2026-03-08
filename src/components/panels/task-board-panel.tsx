'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  HalfMoon, CheckCircle, Clock,
  NavArrowUp, Xmark, OpenNewWindow,
} from 'iconoir-react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { PropertyChip, type PropertyOption } from '@/components/ui/property-chip'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { BlockEditor } from '@/components/ui/block-editor'
import { Badge } from '@/components/ui/badge'

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return `${Math.floor(diff / 604800)}w ago`
}

interface Task {
  id: number
  title: string
  description?: string
  status: 'draft' | 'open' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  last_activity_at?: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
  badge?: 'idea' | 'proposal' | null
  project_id?: string
  project_title?: string
  last_turn_at?: number | null
  seen_at?: number | null
  picked?: number
  picked_at?: number | null
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Primary: priority (high first)
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
    if (pDiff !== 0) return pDiff
    // Secondary: last_turn_at DESC (most recent first)
    const aTime = a.last_turn_at ?? a.updated_at
    const bTime = b.last_turn_at ?? b.updated_at
    return bTime - aTime
  })
}

function hasUnseenTurns(task: Task): boolean {
  if (!task.last_turn_at) return false
  if (!task.seen_at) return true
  return task.last_turn_at > task.seen_at
}

const TWO_HOURS_S = 2 * 60 * 60

function isStale(task: Task): boolean {
  if (task.status !== 'open') return false
  if (!task.assigned_to || task.assigned_to.toLowerCase() === 'cri') return false
  const lastActivity = task.last_activity_at ?? task.updated_at
  return Math.floor(Date.now() / 1000) - lastActivity > TWO_HOURS_S
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

interface Turn {
  id: string
  task_id: string
  round_number: number
  type: 'instruction' | 'result' | 'note'
  author: string
  content: string
  links: Array<{ url: string; title?: string; type?: string }>
  created_at: string
  updated_at: string
}

interface Project {
  id: string
  title: string
  description?: string
  emoji: string
}

const statusColumns = [
  { key: 'drafts', title: 'Drafts', color: 'bg-secondary text-foreground' },
  { key: 'open', title: 'Open', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'closed', title: 'Closed', color: 'bg-green-500/20 text-green-400' },
]

export function TaskBoardPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [hideUnassigned, setHideUnassigned] = useState(true)
  const [focusedListIndex, setFocusedListIndex] = useState<number | null>(null)
  const listRowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Fetch tasks and agents
  const fetchData = useCallback(async (silent?: boolean | React.MouseEvent) => {
    const isSilent = typeof silent === 'boolean' ? silent : false
    try {
      if (!isSilent) setLoading(true)
      setError(null)

      const [tasksResponse, agentsResponse, projectsResponse] = await Promise.all([
        fetch('/api/tasks'),
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

      setTasks(tasksList)
      setAgents(agentsData.agents || [])
      setProjects(projectsData.projects || [])

      // Keep selectedTask in sync with fresh data
      setSelectedTask((prev: Task | null) => {
        if (!prev) return null
        const fresh = tasksList.find((t: Task) => t.id === prev.id)
        return fresh || null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Keyboard navigation
  useEffect(() => {
    const modalOpen = selectedTask !== null || showCreateModal
    function handleKey(e: KeyboardEvent) {
      // Escape closes modal from anywhere
      if (e.key === 'Escape' && modalOpen) {
        e.preventDefault()
        if (selectedTask) setSelectedTask(null)
        else if (showCreateModal) setShowCreateModal(false)
        return
      }
      if (modalOpen) return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return

      // List mode keyboard navigation
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return
      e.preventDefault()

      if (e.key === 'Escape') { setFocusedListIndex(null); return }

      const tasks = allTasksRef.current
      if (e.key === 'Enter' && focusedListIndex !== null) {
        if (tasks[focusedListIndex]) setSelectedTask(tasks[focusedListIndex])
        return
      }

      if (focusedListIndex === null) { setFocusedListIndex(0); return }

      if (e.key === 'ArrowDown') {
        setFocusedListIndex(Math.min(focusedListIndex + 1, tasks.length - 1))
      } else if (e.key === 'ArrowUp') {
        setFocusedListIndex(Math.max(focusedListIndex - 1, 0))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [focusedListIndex, selectedTask, showCreateModal])

  // Scroll focused row into view (list)
  useEffect(() => {
    if (focusedListIndex !== null) {
      listRowRefs.current[focusedListIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedListIndex])

  // Keep a ref to allTasks for keyboard handler in list view
  const allTasksRef = useRef<Task[]>([])

  // Filter tasks by selected project and assignee visibility
  const filteredTasks = tasks.filter(task => {
    // Hide unassigned tasks when toggle is on
    if (hideUnassigned && !task.assigned_to) return false

    if (selectedProjectFilter === null) {
      // "All Projects" - show everything
      return true
    } else if (selectedProjectFilter === '') {
      // "Unassigned" - show only tasks with no project
      return !task.project_id
    } else {
      // Specific project - show only matching tasks
      return task.project_id === selectedProjectFilter
    }
  })

  // Group tasks by column (derived server-side)
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = filteredTasks.filter(task => (task as any).column === column.key)
    return acc
  }, {} as Record<string, Task[]>)

  // Split open tasks into "My Tasks" (cri) and "Agent Tasks" (others)
  const openTasks = tasksByStatus['open'] || []
  const myTasks = sortTasks(openTasks.filter(t => t.assigned_to?.toLowerCase() === 'cri'))
  const agentTasks = sortTasks(openTasks.filter(t => t.assigned_to && t.assigned_to.toLowerCase() !== 'cri'))

  // Flat task list for list view (grouped and sorted)
  const listSections = [
    { key: 'drafts', tasks: tasksByStatus['drafts'] || [] },
    { key: 'my-tasks', tasks: myTasks },
    { key: 'agent-tasks', tasks: agentTasks },
    ...(showClosed ? [{ key: 'closed', tasks: tasksByStatus['closed'] || [] }] : []),
  ].filter(s => s.tasks.length > 0)

  const allTasks = listSections.flatMap(section => section.tasks)
  allTasksRef.current = allTasks

  // Assignee options for PropertyChip
  const assigneeOptions: PropertyOption[] = [
    { value: '', label: 'Unassigned' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode,
    })),
  ]

  const projectChipOptions: PropertyOption[] = [
    { value: '', label: 'No project' },
    ...projects.map(p => ({ value: p.id, label: `${p.emoji} ${p.title}` })),
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2 text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">Tasks</h2>
        <div className="flex gap-2">
          {/* Project Filter */}
          <PropertyChip
            value={selectedProjectFilter === null ? 'all' : selectedProjectFilter}
            options={[
              { value: 'all', label: 'All Projects' },
              { value: '', label: 'Unassigned' },
              ...projects.map((p) => ({ value: p.id, label: `${p.emoji} ${p.title}` })),
            ]}
            onSelect={(value) => {
              if (value === 'all') {
                setSelectedProjectFilter(null)
              } else {
                setSelectedProjectFilter(value)
              }
            }}
            align="left"
          />

          <Button
            variant={hideUnassigned ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setHideUnassigned(prev => !prev)}
            title={hideUnassigned ? 'Show unassigned tasks' : 'Hide unassigned tasks'}
            className="text-muted-foreground"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
              <circle cx="8" cy="5" r="3" />
              <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" />
              {hideUnassigned && <path d="M2 2l12 12" stroke="currentColor" strokeWidth="2" />}
            </svg>
            <span className="hidden sm:inline ml-1">Assigned</span>
          </Button>
          <Button
            variant={showClosed ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setShowClosed(prev => !prev)}
            title={showClosed ? 'Hide closed tasks' : 'Show closed tasks'}
            className="text-muted-foreground"
          >
            <CheckCircle width={14} height={14} />
            <span className="hidden sm:inline ml-1">Closed</span>
          </Button>
          <Button
            onClick={() => setShowCreateModal(true)}
            title="New task"
            className="max-sm:size-8 max-sm:p-0"
          >
            <svg className="sm:hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span className="hidden sm:inline">+ New Task</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchData}
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            ×
          </Button>
        </div>
      )}

      {/* List View */}
      {(() => {
        const listSectionsWithLabels = [
          { key: 'drafts', label: 'Drafts', tasks: tasksByStatus['drafts'] || [], rowClass: '' },
          { key: 'my-tasks', label: 'Me', tasks: myTasks, rowClass: '' },
          { key: 'agent-tasks', label: 'Crew', tasks: agentTasks, rowClass: '' },
          ...(showClosed ? [{ key: 'closed', label: 'Closed', tasks: tasksByStatus['closed'] || [], rowClass: '' }] : []),
        ].filter(s => s.tasks.length > 0)

        // Build flat index → task mapping for keyboard nav
        let flatIdx = 0
        const flatMap: { task: Task; idx: number }[] = []
        listSectionsWithLabels.forEach(section => {
          section.tasks.forEach(task => {
            flatMap.push({ task, idx: flatIdx++ })
          })
        })

        const getEmptyMessage = () => {
          if (selectedProjectFilter === null) return 'No tasks'
          if (selectedProjectFilter === '') return 'No unassigned tasks'
          const project = projects.find(p => p.id === selectedProjectFilter)
          return project ? `No tasks in ${project.title}` : 'No tasks in this project'
        }

        return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {flatMap.length === 0 ? (
            <div className="text-center text-muted-foreground/50 py-8 text-sm">{getEmptyMessage()}</div>
          ) : (
            listSectionsWithLabels.map(section => {
              return (
                <div key={section.key}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{section.label}</span>
                    <span className="text-[10px] text-muted-foreground/50">{section.tasks.length}</span>
                  </div>
                  <div className={`bg-card border rounded-lg overflow-hidden ${section.key === 'drafts' ? 'border-dashed border-border/60' : 'border-border'}`}>
                    {section.tasks.map(task => {
                      const globalIdx = flatMap.find(f => f.task.id === task.id)?.idx ?? -1
                      const isFocused = focusedListIndex === globalIdx
                      return (
                        <div
                          key={task.id}
                          ref={(el) => { listRowRefs.current[globalIdx] = el }}
                          onClick={() => setSelectedTask(task)}
                          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 px-4 py-2.5 border-b border-zinc-800/50 last:border-b-0 cursor-pointer hover:bg-zinc-800 transition-colors ${section.rowClass || ''} ${
                            isFocused ? 'bg-zinc-800' : ''
                          }`}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0 flex items-center gap-1.5">
                            {hasUnseenTurns(task) && (
                              <span title="New activity" className="inline-block size-2 rounded-full bg-blue-500 shrink-0" />
                            )}
                            {task.title}
                            {isStale(task) && (
                              <span title="No activity in 2+ hours" className="inline-block size-1.5 rounded-full bg-amber-500 shrink-0" />
                            )}
                          </span>
                          <div className="flex items-center gap-1.5 sm:shrink-0 sm:justify-end" onClick={e => e.stopPropagation()}>
                            {task.priority === 'high' && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="bg-red-500/15 text-red-400 pointer-events-none"
                              >
                                <NavArrowUp width={14} height={14} />
                              </Button>
                            )}
                            <PropertyChip
                              value={task.assigned_to || ''}
                              options={assigneeOptions}
                              onSelect={(v) => {
                                fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_to: v || null }) }).then(() => fetchData())
                              }}
                              searchable
                              align="right"
                              placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}
                            />
                            {/* Project chip */}
                            {task.project_id && (
                              <PropertyChip
                                value={task.project_id}
                                options={projectChipOptions}
                                onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: v || null }) }).then(() => fetchData()) }}
                              />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
        )
      })()}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          key={selectedTask.id}
          task={selectedTask}
          agents={agents}
          projects={projects}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => fetchData(true)}
          onNavigate={(task) => setSelectedTask(task)}
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
    </div>
  )
}

// --- Task Detail Modal ---

function TaskDetailModal({
  task,
  agents,
  projects,
  allTasks = [],
  onClose,
  onUpdate,
  onNavigate,
}: {
  task: Task
  agents: Agent[]
  projects: Project[]
  allTasks?: Task[]
  onClose: () => void
  onUpdate: () => void
  onNavigate?: (task: Task) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [assignee, setAssignee] = useState(task.assigned_to || '')
  // creator kept in DB for traceability but removed from UI
  const [projectId, setProjectId] = useState(task.project_id || '')
  const [projectLoading, setProjectLoading] = useState(false)

  // Navigation
  const currentIndex = allTasks.findIndex(t => t.id === task.id)
  const prevTask = currentIndex > 0 ? allTasks[currentIndex - 1] : null
  const nextTask = currentIndex < allTasks.length - 1 ? allTasks[currentIndex + 1] : null

  const [turns, setTurns] = useState<Turn[]>([])
  const [loadingTurns, setLoadingTurns] = useState(false)
  const [turnText, setTurnText] = useState('')
  const [turnError, setTurnError] = useState<string | null>(null)
  const [turnMode, setTurnMode] = useState<'note' | 'instruction'>('note')
  const [turnAssignee, setTurnAssignee] = useState('')
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set())

  const [saving, setSaving] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)

  // Reset state when task changes (navigation)
  useEffect(() => {
    setTitle(task.title)
    setEditingTitle(false)
    setDescription(task.description || '')
    setStatus(task.status)
    setPriority(task.priority)
    setAssignee(task.assigned_to || '')
    // creator state removed from UI
    setProjectId(task.project_id || '')
    setTurnText('')
    setTurnError(null)
    setTurnMode('note')
    setExpandedRounds(new Set())

  }, [task.id])

  // Keyboard navigation (← →)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'ArrowUp' && prevTask && onNavigate) {
        e.preventDefault()
        onNavigate(prevTask)
      } else if (e.key === 'ArrowDown' && nextTask && onNavigate) {
        e.preventDefault()
        onNavigate(nextTask)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [prevTask, nextTask, onNavigate])

  // --- Save a single field ---
  const saveField = async (field: string, value: string) => {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      onUpdate()
    } catch {} finally { setSaving(false) }
  }

  const handleStatusChange = (v: string) => { setStatus(v as any); saveField('status', v) }
  const handlePriorityChange = (v: string) => { setPriority(v as any); saveField('priority', v) }
  const togglePriority = () => {
    const next = priority === 'high' ? 'medium' : 'high'
    handlePriorityChange(next)
  }
  const handleAssigneeChange = (v: string) => {
    setAssignee(v)
    saveField('assigned_to', v)
  }
  // handleCreatorChange removed — creator not shown in UI

  const handleProjectChange = async (v: string) => {
    if (v === '✨-new') {
      // AI project generation
      setProjectLoading(true)
      try {
        const response = await fetch('/api/projects/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id })
        })
        const data = await response.json()
        if (response.ok && data.id) {
          setProjectId(data.id)
          onUpdate()
        }
      } catch (e) {
        console.error('Failed to generate project', e)
      } finally {
        setProjectLoading(false)
      }
    } else {
      // Existing project or no project
      setProjectId(v)
      saveField('project_id', v)
    }
  }

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (title.trim() && title !== task.title) saveField('title', title.trim())
    else if (!title.trim()) setTitle(task.title)
  }

  const handleDescriptionSave = (markdown: string) => {
    // Normalize: collapse 3+ newlines to 2 (BlockNote round-trip inflates whitespace)
    const trimmed = markdown.trim().replace(/\n{3,}/g, '\n\n')
    if (trimmed !== (task.description || '').trim().replace(/\n{3,}/g, '\n\n')) {
      setDescription(trimmed)
      saveField('description', trimmed)
    }
  }

  const handleClose = () => { onUpdate(); onClose() }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
      if (res.ok) { onUpdate(); onClose() }
      else { console.error('Delete failed', res.status); setConfirmDelete(false) }
    } catch (e) { console.error('Failed to delete task', e); setConfirmDelete(false) }
  }

  // Build assignee options (detail modal)
  const detailAssigneeOptions: PropertyOption[] = [
    { value: '', label: 'Unassigned', icon: '—' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> as React.ReactNode, group: 'Humans' },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode, group: 'Agents',
    })),
  ]
    const projectOptions: PropertyOption[] = [
    { value: '', label: 'No project', icon: '—' },
    ...projects.map(p => ({
      value: p.id,
      label: p.title,
      icon: p.emoji,
    })),
    { value: '✨-new', label: 'New' },
  ]

  const fetchTurns = useCallback(async () => {
    try {
      setLoadingTurns(true)
      const response = await fetch(`/api/tasks/${task.id}/turns`)
      if (!response.ok) throw new Error('Failed to fetch turns')
      const data = await response.json()
      setTurns(data.turns || [])
    } catch {
      setTurnError('Failed to load turns')
    } finally {
      setLoadingTurns(false)
    }
  }, [task.id])

  useEffect(() => { fetchTurns() }, [fetchTurns])
  useSmartPoll(fetchTurns, 15000)

  // Mark as seen when modal opens
  useEffect(() => {
    fetch(`/api/tasks/${task.id}/seen`, { method: 'PUT' }).catch(() => {})
  }, [task.id])

  const handleSubmitTurn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!turnText.trim()) return
    if (turnMode === 'instruction' && !turnAssignee) {
      setTurnError('Select who to pass the ball to')
      return
    }
    try {
      setTurnError(null)
      const body: Record<string, unknown> = {
        type: turnMode,
        content: turnText.trim(),
        author: 'cri',
      }
      if (turnMode === 'instruction') {
        body.assigned_to = turnAssignee
      }
      const response = await fetch(`/api/tasks/${task.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('Failed to create turn')
      setTurnText('')
      setTurnMode('note')
      await fetchTurns()
      onUpdate()
    } catch { setTurnError('Failed to create turn') }
  }

  const authorColor = (name: string) => {
    const n = name.toLowerCase()
    if (n === 'cri' || n === 'cristiano') return 'text-pink-400'
    if (n === 'cseno' || n === 'bot') return 'text-lime-400'
    if (n === 'cody') return 'text-blue-400'
    if (n === 'ralph') return 'text-amber-400'
    if (n === 'scottie') return 'text-cyan-400'
    if (n === 'bookworm') return 'text-purple-400'
    return 'text-foreground/80'
  }

  const turnTypeLabel = (type: string) => {
    if (type === 'instruction') return { text: 'Instruction', color: 'bg-blue-500/15 text-blue-400' }
    if (type === 'result') return { text: 'Result', color: 'bg-green-500/15 text-green-400' }
    return { text: 'Note', color: 'bg-zinc-500/15 text-zinc-400' }
  }

  // Group turns by round
  const roundsMap = new Map<number, Turn[]>()
  for (const turn of turns) {
    const existing = roundsMap.get(turn.round_number) || []
    existing.push(turn)
    roundsMap.set(turn.round_number, existing)
  }
  const roundNumbers = [...roundsMap.keys()].sort((a, b) => b - a) // newest first
  const maxRound = roundNumbers.length > 0 ? roundNumbers[0] : 0

  const renderTurnContent = (turn: Turn) => (
    <div className="text-sm text-muted-foreground mt-1 prose prose-sm prose-invert max-w-none
      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
      prose-h1:text-base prose-h2:text-sm prose-h3:text-xs
      prose-p:my-1 prose-p:leading-relaxed
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-code:text-primary prose-code:bg-surface-1 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-['']
      prose-pre:bg-surface-1 prose-pre:text-foreground prose-pre:border prose-pre:border-border prose-pre:rounded prose-pre:p-2 prose-pre:text-xs prose-pre:overflow-x-auto
      prose-ul:my-1 prose-ul:list-disc prose-ul:pl-4
      prose-ol:my-1 prose-ol:list-decimal prose-ol:pl-4
      prose-li:my-0.5
      prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-muted-foreground
      prose-hr:border-border prose-hr:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {turn.content}
      </ReactMarkdown>
    </div>
  )

  const renderTurnLinks = (links: Turn['links']) => {
    if (!links || links.length === 0) return null
    return (
      <div className="flex gap-2 flex-wrap mt-2">
        {links.map((link, i) => {
          let domain = ''
          try { domain = new URL(link.url).hostname.replace('www.', '') } catch {}
          return (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs bg-surface-1 border border-border rounded-md px-2 py-1 hover:bg-zinc-800 transition-colors text-muted-foreground hover:text-foreground"
            >
              <OpenNewWindow width={12} height={12} className="shrink-0" />
              <span className="truncate max-w-[200px]">{link.title || domain || link.url}</span>
              {link.type && (
                <span className="text-[10px] bg-zinc-700/50 px-1 rounded">{link.type}</span>
              )}
            </a>
          )
        })}
      </div>
    )
  }

  const renderTurn = (turn: Turn) => {
    const label = turnTypeLabel(turn.type)
    const edited = turn.updated_at !== turn.created_at
    return (
      <div key={turn.id} className="border-l-2 border-border pl-3 group/turn">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AgentAvatar agent={turn.author} size="sm" />
          <span className={`font-semibold ${authorColor(turn.author)}`}>{turn.author}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${label.color}`}>{label.text}</span>
          <span className="ml-auto">{new Date(turn.created_at).toLocaleString()}</span>
          {edited && <span className="text-muted-foreground/40" title={`Edited ${new Date(turn.updated_at).toLocaleString()}`}>(edited)</span>}
        </div>
        {renderTurnContent(turn)}
        {renderTurnLinks(turn.links)}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Fixed Header: nav + title + chips */}
        <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              {saving && <span className="text-[10px] text-muted-foreground/50">Saving...</span>}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                onMouseLeave={() => setConfirmDelete(false)}
                title={confirmDelete ? 'Click again to confirm' : 'Delete task'}
                className={confirmDelete ? 'text-red-400 bg-red-500/15 hover:bg-red-500/20' : 'text-red-400/40 hover:text-red-400 hover:bg-red-500/10'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </Button>
              {onNavigate && (
                <>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => prevTask && onNavigate(prevTask)}
                    disabled={!prevTask}
                    title="Previous task (↑)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => nextTask && onNavigate(nextTask)}
                    disabled={!nextTask}
                    title="Next task (↓)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                  </Button>
                </>
              )}
              <Button variant="outline" size="icon-sm" onClick={handleClose} title="Close (Esc)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </Button>
            </div>
          </div>

          {/* Editable Title */}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleTitleBlur() } if (e.key === 'Escape') { setTitle(task.title); setEditingTitle(false) } }}
              className="w-full text-xl font-bold text-foreground bg-transparent border-b border-primary/30 focus:border-primary focus:outline-none pb-1 mb-2"
              autoFocus
            />
          ) : (
            <h3
              className="text-xl font-bold text-foreground cursor-text hover:bg-surface-1/50 rounded px-1 -mx-1 py-0.5 mb-2 transition-colors"
              onClick={() => setEditingTitle(true)}
            >{title}</h3>
          )}

          {/* Property Chips */}
          <div className="flex flex-wrap gap-2">
            {/* Contextual action buttons based on status */}
            {status === 'draft' && (
              <PropertyChip
                value=""
                options={detailAssigneeOptions.filter(o => o.value !== '')}
                onSelect={(agent) => { handleAssigneeChange(agent); handleStatusChange('open') }}
                searchable
                placeholder={<span className="flex items-center gap-1 text-muted-foreground/60 hover:text-foreground"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Delegate</span>}
              />
            )}
            {status === 'open' && (
              <Button size="xs" variant="ghost" onClick={() => handleStatusChange('closed')}
                className="text-muted-foreground/60 hover:text-red-400">
                <CheckCircle width={14} height={14} />
                Close
              </Button>
            )}
            {status === 'closed' && (
              <Button size="xs" variant="ghost" onClick={() => handleStatusChange('open')}
                className="text-muted-foreground/60 hover:text-green-400">
                <HalfMoon width={14} height={14} />
                Reopen
              </Button>
            )}
            <Button
              variant={priority === 'high' ? 'default' : 'ghost'}
              size="xs"
              onClick={togglePriority}
              className={priority === 'high' ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30' : 'text-muted-foreground/40 hover:text-muted-foreground'}
            >
              <NavArrowUp width={14} height={14} />
              {priority === 'high' && <span className="ml-1">High</span>}
            </Button>
            <PropertyChip value={assignee} options={detailAssigneeOptions} onSelect={handleAssigneeChange} searchable label="Assignee" placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>} />
            <PropertyChip
              value={projectId}
              options={projectOptions}
              onSelect={handleProjectChange}
              searchable
              label="Project"
              placeholder={projectLoading ? <span className="flex items-center gap-1 text-muted-foreground/40">Loading...</span> : <span className="flex items-center gap-1 text-muted-foreground/40">No project</span>}
              icon={projectLoading ? <span className="animate-spin">⏳</span> : undefined}
            />
            <Badge variant="secondary" className="ml-auto" title={new Date(task.created_at * 1000).toLocaleString()}>
              <Clock width={10} height={10} />
              {timeAgo(task.created_at)}
            </Badge>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          {/* Description — BlockNote */}
          <div className="mb-4 -mx-1">
            <BlockEditor
              initialMarkdown={description}
              onBlur={handleDescriptionSave}
              placeholder="Add a description..."
              compact
            />
          </div>

          {/* Turns Timeline */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">Turns</h4>
              <Button variant="ghost" size="xs" onClick={fetchTurns} className="text-muted-foreground/40 hover:text-muted-foreground">Refresh</Button>
            </div>

            {turnError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-xs mb-3">{turnError}</div>
            )}

            {loadingTurns ? (
              <div className="text-muted-foreground text-xs py-2">Loading turns...</div>
            ) : turns.length === 0 ? (
              <div className="text-muted-foreground/40 text-xs py-2">No turns yet. Pass the ball to start a conversation.</div>
            ) : (
              <div className="space-y-4">
                {roundNumbers.map(roundNum => {
                  const roundTurns = roundsMap.get(roundNum) || []
                  const isActive = roundNum === maxRound
                  const isExpanded = isActive || expandedRounds.has(roundNum)
                  const firstTurn = roundTurns[0]
                  const preview = firstTurn?.content?.substring(0, 80) || ''

                  if (roundNum === 0) {
                    // Round 0 = migrated notes, always show inline
                    return (
                      <div key={roundNum} className="space-y-3">
                        {roundTurns.map(turn => renderTurn(turn))}
                      </div>
                    )
                  }

                  return (
                    <div key={roundNum} className="border border-border/50 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          if (isActive) return
                          setExpandedRounds(prev => {
                            const next = new Set(prev)
                            if (next.has(roundNum)) next.delete(roundNum)
                            else next.add(roundNum)
                            return next
                          })
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${
                          isActive ? 'bg-surface-1/50 cursor-default' : 'hover:bg-surface-1/30 cursor-pointer'
                        }`}
                      >
                        <span className="font-semibold text-muted-foreground">Round {roundNum}</span>
                        {!isExpanded && (
                          <span className="text-muted-foreground/50 truncate flex-1">{preview}{preview.length >= 80 ? '...' : ''}</span>
                        )}
                        {isActive && <Badge variant="secondary" className="ml-auto text-[10px]">Active</Badge>}
                        {!isActive && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
                        )}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3">
                          {roundTurns.map(turn => renderTurn(turn))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer: turn composer */}
        <div className="shrink-0 px-4 py-3 border-t border-border">
          <form onSubmit={handleSubmitTurn}>
            <div className="flex flex-col gap-2">
              {/* Mode toggle */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={turnMode === 'note' ? 'outline' : 'ghost'}
                  size="xs"
                  onClick={() => setTurnMode('note')}
                >
                  Add note
                </Button>
                <Button
                  type="button"
                  variant={turnMode === 'instruction' ? 'outline' : 'ghost'}
                  size="xs"
                  onClick={() => setTurnMode('instruction')}
                  className={turnMode === 'instruction' ? 'border-blue-500/30 text-blue-400' : ''}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Pass the ball
                </Button>
                {turnMode === 'instruction' && (
                  <PropertyChip
                    value={turnAssignee}
                    options={detailAssigneeOptions.filter(o => o.value !== '')}
                    onSelect={setTurnAssignee}
                    searchable
                    placeholder={<span className="text-muted-foreground/40 text-xs">Assign to...</span>}
                  />
                )}
              </div>

              {/* Input row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={turnText}
                  onChange={e => setTurnText(e.target.value)}
                  placeholder={turnMode === 'instruction' ? 'Write instructions...' : 'Add a note...'}
                  className="flex-1 bg-surface-1 text-foreground text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitTurn(e) } }}
                />
                <Button type="submit">{turnMode === 'instruction' ? 'Send' : 'Add'}</Button>
              </div>

              {turnError && (
                <p className="text-xs text-destructive">{turnError}</p>
              )}
            </div>
          </form>
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
    assigned_to: '',
    project_id: '',
  })
  const [projectLoading, setProjectLoading] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus title input on mount
  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  // Build assignee options (same as detail modal)
  const createAssigneeOptions: PropertyOption[] = [
    { value: '', label: 'Unassigned', icon: '—' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> as React.ReactNode, group: 'Humans' },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode, group: 'Agents',
    })),
  ]

  // Build project options
  const createProjectOptions: PropertyOption[] = [
    { value: '', label: 'No project', icon: '—' },
    ...projects.map(p => ({
      value: p.id,
      label: p.title,
      icon: p.emoji,
    })),
    { value: '✨-new', label: 'New' },
  ]

  const handleProjectChange = async (value: string) => {
    if (value === '✨-new') {
      // For create modal, we can't generate a project without a task ID
      // So we'll create the task first, then generate the project
      // This is a special case - we'll handle it in handleSubmit
      setFormData(prev => ({ ...prev, project_id: '✨-new' }))
      return
    }
    setFormData(prev => ({ ...prev, project_id: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) return

    try {
      // Create the task
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim(),
          priority: formData.priority,
          assigned_to: formData.assigned_to || undefined,
          project_id: formData.project_id && formData.project_id !== '✨-new' ? formData.project_id : undefined,
          status: 'open'
        })
      })

      if (!response.ok) throw new Error('Failed to create task')

      const data = await response.json()
      const newTaskId = data.task?.id

      // If user selected "✨ New", generate project and assign it
      if (formData.project_id === '✨-new' && newTaskId) {
        setProjectLoading(true)
        try {
          const projectResponse = await fetch('/api/projects/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: newTaskId })
          })

          if (!projectResponse.ok) throw new Error('Failed to generate project')

          // Project was created and assigned to the task
          // No need to update the task again, the API does it
        } catch (error) {
          console.error('Error generating project:', error)
          // Task was created successfully, just project generation failed
          // Continue anyway
        } finally {
          setProjectLoading(false)
        }
      }

      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating task:', error)
    }
  }

  // Cmd+Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as any)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border">
            <input
              ref={titleInputRef}
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Task title..."
              className="w-full text-xl font-bold text-foreground bg-transparent focus:outline-none mb-2"
              autoFocus
            />

            {/* Property Chips */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={formData.priority === 'high' ? 'default' : 'ghost'}
                size="xs"
                onClick={() => setFormData(prev => ({ ...prev, priority: prev.priority === 'high' ? 'medium' : 'high' }))}
                className={formData.priority === 'high' ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30' : 'text-muted-foreground/40 hover:text-muted-foreground'}
              >
                <NavArrowUp width={14} height={14} />
                {formData.priority === 'high' && <span className="ml-1">High</span>}
              </Button>
              <PropertyChip
                value={formData.assigned_to}
                options={createAssigneeOptions}
                onSelect={(v) => setFormData(prev => ({ ...prev, assigned_to: v }))}
                searchable
                label="Assignee"
                placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}
              />
              <PropertyChip
                value={formData.project_id}
                options={createProjectOptions}
                onSelect={handleProjectChange}
                searchable
                label="Project"
                placeholder={<span className="text-muted-foreground/40">No project</span>}
                icon={projectLoading ? <span className="animate-spin">⏳</span> : undefined}
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
            <div className="-mx-1">
              <BlockEditor
                initialMarkdown=""
                onBlur={(md) => setFormData(prev => ({ ...prev, description: md }))}
                placeholder="Add description..."
                compact
              />
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-4 py-3 border-t border-border">
            <div className="flex gap-2">
              <Button type="submit" disabled={!formData.title.trim()}>
                Create Task
              </Button>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
