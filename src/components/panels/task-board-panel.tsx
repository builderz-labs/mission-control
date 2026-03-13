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
import { AnimatedModal } from '@/components/ui/animated-modal'
import { motion } from 'motion/react'
import { PixelLoader, pixelLoaderPatterns } from '@/components/ui/pixel-loader'

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
  blocked_by?: string[]
  is_blocked?: boolean
  blocker_details?: Array<{ id: string; title: string; status: string }>
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

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setShowCreateModal(true)
        return
      }

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
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <PixelLoader pattern={pixelLoaderPatterns.diagonal} color="hsl(var(--primary))" size={40} speed={150} />
        <span className="text-sm text-muted-foreground">Loading tasks...</span>
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
                          } ${task.is_blocked ? 'opacity-60' : ''}`}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0 flex items-center gap-1.5">
                            {hasUnseenTurns(task) && (
                              <span title="New activity" className="inline-block size-2 rounded-full bg-blue-500 shrink-0" />
                            )}
                            {task.title}
                            {task.is_blocked && (
                              <span title="Blocked by another task" className="shrink-0 text-amber-500">🔒</span>
                            )}
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
                            {section.key !== 'my-tasks' && (
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
                            )}
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
      <AnimatedModal
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        className="max-w-2xl w-full max-h-[90vh]"
      >
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
      </AnimatedModal>

      {/* Create Task Modal */}
      <AnimatedModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        className="max-w-2xl w-full max-h-[90vh]"
      >
        {showCreateModal && (
          <CreateTaskModal
            agents={agents}
            projects={projects}
            onClose={() => setShowCreateModal(false)}
            onCreated={fetchData}
          />
        )}
      </AnimatedModal>
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
  const [blockedBy, setBlockedBy] = useState<string[]>(task.blocked_by || [])
  const [blockerDetails, setBlockerDetails] = useState<Array<{ id: string; title: string; status: string }>>(task.blocker_details || [])

  // Navigation
  const currentIndex = allTasks.findIndex(t => t.id === task.id)
  const prevTask = currentIndex > 0 ? allTasks[currentIndex - 1] : null
  const nextTask = currentIndex < allTasks.length - 1 ? allTasks[currentIndex + 1] : null

  const [turns, setTurns] = useState<Turn[]>([])
  const [loadingTurns, setLoadingTurns] = useState(false)
  const [turnText, setTurnText] = useState('')
  const [turnError, setTurnError] = useState<string | null>(null)
  // Default turn target: last result turn's author (who you'd reply to), or task assignee as fallback
  const [turnAssignee, setTurnAssignee] = useState(() => {
    // Will be updated when turns load
    return task.assigned_to || ''
  })
  const [showToDropdown, setShowToDropdown] = useState(false)
  const toDropdownRef = useRef<HTMLDivElement>(null)
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
    // Don't reset turnAssignee here — fetchTurns will set it from last result author
    setTurnAssignee('')
    setBlockedBy(task.blocked_by || [])
    setBlockerDetails(task.blocker_details || [])
    setExpandedRounds(new Set())

  }, [task.id])

  // Fetch blocker details from single-task endpoint
  useEffect(() => {
    if ((task.blocked_by || []).length === 0 && blockedBy.length === 0) return
    fetch(`/api/tasks/${task.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.task?.blocker_details) setBlockerDetails(data.task.blocker_details)
        if (data.task?.blocked_by) setBlockedBy(data.task.blocked_by)
      })
      .catch(() => {})
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

  // Click-outside for To... dropdown
  useEffect(() => {
    if (!showToDropdown) return
    const handler = (e: MouseEvent) => {
      if (toDropdownRef.current && !toDropdownRef.current.contains(e.target as Node)) {
        setShowToDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showToDropdown])

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

  const handleBlockedByChange = async (newBlockedBy: string[]) => {
    setBlockedBy(newBlockedBy)
    setSaving(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_by: newBlockedBy }),
      })
      if (res.ok) {
        // Re-fetch blocker details
        const detailRes = await fetch(`/api/tasks/${task.id}`)
        const data = await detailRes.json()
        if (data.task?.blocker_details) setBlockerDetails(data.task.blocker_details)
        onUpdate()
      }
    } catch {} finally { setSaving(false) }
  }

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
      const loadedTurns = data.turns || []
      setTurns(loadedTurns)
      // Auto-set turn target to last result turn's author (the agent who reported back)
      const lastResult = [...loadedTurns].reverse().find((t: Turn) => t.type === 'result')
      if (lastResult) {
        setTurnAssignee(lastResult.author)
      }
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

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submitTurn = async (assigneeOverride?: string) => {
    const target = assigneeOverride || turnAssignee
    if (!target) {
      setTurnError('Select who to pass the ball to')
      return
    }
    try {
      setTurnError(null)
      const body: Record<string, unknown> = {
        type: 'instruction',
        content: turnText.trim(),
        author: 'cri',
        assigned_to: target,
      }
      const response = await fetch(`/api/tasks/${task.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('Failed to create turn')
      setTurnText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      await fetchTurns()
      onUpdate()
    } catch { setTurnError('Failed to create turn') }
  }

  const handleSubmitTurn = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitTurn()
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

  const sortRoundTurns = (turns: Turn[]) => [...turns].sort((a, b) => {
    const typeOrder: Record<string, number> = { result: 0, instruction: 1, note: 2 }
    const typeDiff = (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2)
    if (typeDiff !== 0) return typeDiff
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

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
      <div className="bg-card border border-border rounded-lg w-full max-h-[90vh] flex flex-col">
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
            {status === 'closed' && (
              <Button size="xs" variant="ghost" onClick={() => handleStatusChange('open')}
                className="text-muted-foreground/60 hover:text-green-400">
                <HalfMoon width={14} height={14} />
                Reopen
              </Button>
            )}
            {status === 'open' && assignee && agents.some(a => a.name.toLowerCase() === assignee.toLowerCase()) && (
              <Button size="xs" variant="ghost" onClick={async () => {
                try {
                  const res = await fetch(`/api/tasks/${task.id}/poke`, { method: 'POST' })
                  const data = await res.json()
                  alert(res.ok ? `Poked ${data.assignee}!` : (data.error || 'Poke failed'))
                } catch { alert('Poke failed') }
              }}
                className="text-amber-500/60 hover:text-amber-400">
                👉 Poke {assignee}
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
              icon={projectLoading ? <PixelLoader size={12} speed={120} /> : undefined}
            />
            <Badge variant="secondary" className="ml-auto" title={new Date(task.created_at * 1000).toLocaleString()}>
              <Clock width={10} height={10} />
              {timeAgo(task.created_at)}
            </Badge>
          </div>

          {/* Blocked by section */}
          {(blockedBy.length > 0 || status === 'open') && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {blockerDetails.length > 0 && (
                <>
                  <span className="text-xs text-muted-foreground/60 mr-1">🔒 Blocked by</span>
                  {blockerDetails.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        const blockerTask = allTasks.find(t => String(t.id) === b.id)
                        if (blockerTask && onNavigate) onNavigate(blockerTask)
                      }}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                        b.status === 'closed'
                          ? 'border-green-500/30 bg-green-500/10 text-green-400 line-through'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                      }`}
                    >
                      {b.title}
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBlockedByChange(blockedBy.filter(id => id !== b.id))
                        }}
                        className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground cursor-pointer"
                      >×</span>
                    </button>
                  ))}
                </>
              )}
              {status === 'open' && (
                <PropertyChip
                  value=""
                  options={allTasks
                    .filter(t => t.id !== task.id && t.status !== 'closed' && !blockedBy.includes(String(t.id)))
                    .map(t => ({ value: String(t.id), label: t.title }))}
                  onSelect={(taskId) => {
                    if (taskId && !blockedBy.includes(taskId)) {
                      handleBlockedByChange([...blockedBy, taskId])
                    }
                  }}
                  searchable
                  placeholder={<span className="text-muted-foreground/40 text-xs">+ blocker</span>}
                />
              )}
            </div>
          )}

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
                        {sortRoundTurns(roundTurns).map(turn => renderTurn(turn))}
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
                          {sortRoundTurns(roundTurns).map(turn => renderTurn(turn))}
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
              <textarea
                ref={textareaRef}
                value={turnText}
                onChange={e => setTurnText(e.target.value)}
                onInput={e => {
                  const el = e.target as HTMLTextAreaElement
                  el.style.height = 'auto'
                  el.style.height = el.scrollHeight + 'px'
                }}
                placeholder="Write a reply..."
                rows={1}
                className="w-full bg-surface-1 text-foreground text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none overflow-hidden"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitTurn(e) } }}
              />
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm">Pass the ball <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-mono">[^]</span></Button>
                <div className="relative" ref={toDropdownRef}>
                  <Button variant="outline" size="sm" type="button" onClick={() => setShowToDropdown(!showToDropdown)}>
                    To...
                  </Button>
                  {showToDropdown && (
                    <div className="absolute bottom-full mb-1 left-0 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
                      {agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => (
                        <button
                          key={a.name}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-surface-1 transition-colors"
                          onClick={() => { submitTurn(a.name); setShowToDropdown(false) }}
                        >
                          <AgentAvatar agent={a.name} size="sm" />
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1" />
                {status === 'open' && (
                  <Button variant="outline" size="sm" onClick={() => handleStatusChange('closed')} type="button">
                    🏀 Dunk it <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-mono">[0]</span>
                  </Button>
                )}
              </div>
            </div>
            {turnError && (
              <p className="text-xs text-destructive mt-1">{turnError}</p>
            )}
          </form>
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
    description: '',
    priority: 'medium' as Task['priority'],
    assigned_to: '',
    project_id: '',
  })
  const [projectLoading, setProjectLoading] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'loading' | 'success'>('idle')

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

  const createTask = async (status: 'draft' | 'open', assignee?: string) => {
    if (!formData.description.trim()) return
    setSubmitState('loading')

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '',
          description: formData.description.trim(),
          priority: formData.priority,
          assigned_to: assignee || formData.assigned_to || undefined,
          project_id: formData.project_id && formData.project_id !== '✨-new' ? formData.project_id : undefined,
          status,
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
        } catch (error) {
          console.error('Error generating project:', error)
        } finally {
          setProjectLoading(false)
        }
      }

      setSubmitState('success')
      onCreated()
      setTimeout(() => onClose(), 600)
    } catch (error) {
      console.error('Error creating task:', error)
      setSubmitState('idle')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await createTask('draft')
  }

  // Cmd+Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as any)
    }
  }

  return (
      <div className="bg-card border border-border rounded-lg w-full max-h-[90vh] flex flex-col relative" onKeyDown={handleKeyDown}>
        {/* Success overlay */}
        {submitState === 'success' && (
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center bg-card/80 rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', duration: 0.4 }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </motion.div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border">
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
                icon={projectLoading ? <PixelLoader size={12} speed={120} /> : undefined}
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
            <div className="-mx-1">
              <BlockEditor
                initialMarkdown=""
                onBlur={(md) => setFormData(prev => ({ ...prev, description: md }))}
                placeholder="What needs to be done?"
                compact
                autoFocus
              />
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-4 py-3 border-t border-border">
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={submitState !== 'idle'}>
                {submitState === 'loading' ? 'Creating...' : 'Bench'}
              </Button>
              <PropertyChip
                value=""
                options={createAssigneeOptions.filter(o => o.value !== '')}
                onSelect={(agent) => createTask('open', agent)}
                searchable
                placeholder={
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 cursor-pointer">
                    {submitState === 'loading' ? '⏳ Creating...' : '🏀 Tip Off'}
                  </span>
                }
              />
              <Button variant="ghost" type="button" onClick={onClose} className="ml-auto" disabled={submitState === 'loading'}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </div>
  )
}
