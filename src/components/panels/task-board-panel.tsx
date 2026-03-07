'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Circle, HalfMoon, CheckCircle, Prohibition, WarningTriangle, Clock,
  NavArrowUp, Minus, NavArrowDown, Eye, Attachment, Xmark,
} from 'iconoir-react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { PropertyChip, type PropertyOption } from '@/components/ui/property-chip'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { BlockEditor } from '@/components/ui/block-editor'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { Lightbox } from '@/components/ui/lightbox'
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
  status: 'open' | 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'blocked' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
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
  project_id?: string
  project_title?: string
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
  attachments?: Array<{ url: string; filename: string; originalName?: string }>
}

interface Project {
  id: string
  title: string
  description?: string
  emoji: string
}

const statusColumns = [
  { key: 'inbox', title: 'Inbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'blocked', title: 'Blocked', color: 'bg-rose-500/20 text-rose-400' },
  { key: 'done', title: 'Done', color: 'bg-green-500/20 text-green-400' },
]

const priorityColors = {
  low: 'border-green-500',
  medium: 'border-yellow-500',
  high: 'border-orange-500',
  urgent: 'border-red-500',
}

export function TaskBoardPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('mc-task-view') as 'kanban' | 'list') || 'list'
    }
    return 'list'
  })
  const [focusedIndex, setFocusedIndex] = useState<{ col: number; row: number } | null>(null)
  const [focusedListIndex, setFocusedListIndex] = useState<number | null>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const listRowRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragCounter = useRef(0)

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

      let aegisMap: Record<number, boolean> = {}
      if (taskIds.length > 0) {
        try {
          const reviewResponse = await fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          if (reviewResponse.ok) {
            const reviewData = await reviewResponse.json()
            const latest = reviewData.latest || {}
            aegisMap = Object.fromEntries(
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved'
              ])
            )
          }
        } catch (error) {
          aegisMap = {}
        }
      }

      const updatedTasks = tasksList.map((task: Task) => ({
        ...task,
        aegisApproved: Boolean(aegisMap[task.id])
      }))
      setTasks(updatedTasks)
      setAgents(agentsData.agents || [])
      setProjects(projectsData.projects || [])

      // Keep selectedTask in sync with fresh data
      setSelectedTask((prev: Task | null) => {
        if (!prev) return null
        const fresh = updatedTasks.find((t: Task) => t.id === prev.id)
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

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('mc-task-view', viewMode)
  }, [viewMode])

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

      // L to toggle view mode
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        setViewMode(prev => prev === 'kanban' ? 'list' : 'kanban')
        setFocusedIndex(null)
        setFocusedListIndex(null)
        return
      }

      if (viewMode === 'kanban') {
        const tbs = tasksByStatusRef.current
        // Build nav columns: 0=inbox, 1=in_progress (if non-empty), then assigned, done
        const cols = [
          tbs['inbox'] || [],
          ...(tbs['in_progress']?.length ? [tbs['in_progress']] : []),
          tbs['assigned'] || [],
          tbs['done'] || [],
        ]
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return
        e.preventDefault()

        if (e.key === 'Escape') { setFocusedIndex(null); return }

        if (e.key === 'Enter' && focusedIndex) {
          const col = cols[focusedIndex.col]
          if (col && col[focusedIndex.row]) setSelectedTask(col[focusedIndex.row])
          return
        }

        if (!focusedIndex) {
          for (let c = 0; c < cols.length; c++) {
            if (cols[c].length > 0) { setFocusedIndex({ col: c, row: 0 }); return }
          }
          return
        }

        let { col, row } = focusedIndex
        if (e.key === 'ArrowDown') {
          row = Math.min(row + 1, (cols[col]?.length || 1) - 1)
        } else if (e.key === 'ArrowUp') {
          row = Math.max(row - 1, 0)
        } else if (e.key === 'ArrowRight') {
          col = Math.min(col + 1, cols.length - 1)
          row = Math.min(row, (cols[col]?.length || 1) - 1)
        } else if (e.key === 'ArrowLeft') {
          col = Math.max(col - 1, 0)
          row = Math.min(row, (cols[col]?.length || 1) - 1)
        }
        setFocusedIndex({ col, row })
      } else {
        // List mode
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
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [viewMode, focusedIndex, focusedListIndex, selectedTask, showCreateModal])

  // Scroll focused card into view (kanban)
  useEffect(() => {
    if (focusedIndex) {
      const key = `${focusedIndex.col}-${focusedIndex.row}`
      const el = cardRefs.current.get(key)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  // Scroll focused row into view (list)
  useEffect(() => {
    if (focusedListIndex !== null) {
      listRowRefs.current[focusedListIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedListIndex])

  // Keep a ref to tasksByStatus for keyboard handler (avoids stale closure)
  const tasksByStatusRef = useRef<Record<string, Task[]>>({})
  // Keep a ref to allTasks for keyboard handler in list view
  const allTasksRef = useRef<Task[]>([])

  // Filter tasks by selected project
  const filteredTasks = tasks.filter(task => {
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

  // Sort priority: blocked and review tasks float to top
  const statusSortOrder: Record<string, number> = { blocked: 0, review: 1, quality_review: 2 }
  const sortWithPriority = (tasks: Task[]) =>
    [...tasks].sort((a, b) => (statusSortOrder[a.status] ?? 99) - (statusSortOrder[b.status] ?? 99))

  // Group tasks by status
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = sortWithPriority(filteredTasks.filter(task => (task as any).column === column.key || task.status === column.key))
    return acc
  }, {} as Record<string, Task[]>)
  tasksByStatusRef.current = tasksByStatus

  // Flat task list for list view (grouped and sorted)
  const listSections = [
    { key: 'blocked', tasks: tasksByStatus['blocked'] || [] },
    { key: 'review', tasks: tasksByStatus['review'] || [] },
    { key: 'quality_review', tasks: tasksByStatus['quality_review'] || [] },
    { key: 'in_progress', tasks: tasksByStatus['in_progress'] || [] },
    { key: 'assigned', tasks: tasksByStatus['assigned'] || [] },
    { key: 'inbox', tasks: tasksByStatus['inbox'] || [] },
    { key: 'done', tasks: tasksByStatus['done'] || [] },
  ].filter(s => s.tasks.length > 0)

  const allTasks = listSections.flatMap(section => section.tasks)
  allTasksRef.current = allTasks

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

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    dragCounter.current = 0
    e.currentTarget.classList.remove('drag-over')

    if (!draggedTask || draggedTask.status === newStatus) {
      setDraggedTask(null)
      return
    }

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

      // Optimistically update UI
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: newStatus as Task['status'], updated_at: Math.floor(Date.now() / 1000) }
            : task
        )
      )

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
      // Revert optimistic update
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: draggedTask.status }
            : task
        )
      )
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
          {/* View toggle */}
          <Tabs value={viewMode} onValueChange={(v) => { setViewMode(v as 'kanban' | 'list'); if (v === 'kanban') setFocusedListIndex(null); else setFocusedIndex(null) }}>
            <TabsList>
              <TabsTab value="kanban" title="Board view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/></svg>
              </TabsTab>
              <TabsTab value="list" title="List view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </TabsTab>
            </TabsList>
          </Tabs>

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

      {/* Kanban Board */}
      {viewMode === 'kanban' && (() => {
        // Build columns: inbox (double width), then in_progress stacked on assigned, then done
        const inboxTasks = tasksByStatus['inbox'] || []
        const assignedTasks = tasksByStatus['assigned'] || []
        const inProgressTasks = tasksByStatus['in_progress'] || []
        const doneTasks = tasksByStatus['done'] || []

        // Keyboard nav column indices must match the cols array in the handler:
        // cols = [inbox, ...(in_progress if non-empty), assigned, done]
        const hasInProgress = inProgressTasks.length > 0
        const COL_INBOX = 0
        const COL_IN_PROGRESS = hasInProgress ? 1 : -1  // -1 = not rendered
        const COL_ASSIGNED = hasInProgress ? 2 : 1
        const COL_DONE = hasInProgress ? 3 : 2

        const renderCard = (task: Task, colIdx: number, rowIdx: number) => {
          const isFocused = focusedIndex?.col === colIdx && focusedIndex?.row === rowIdx
          return (
            <div
              key={task.id}
              ref={(el) => { if (el) cardRefs.current.set(`${colIdx}-${rowIdx}`, el) }}
              draggable
              onDragStart={(e) => handleDragStart(e, task)}
              onClick={() => setSelectedTask(task)}
              className={`${isFocused ? 'bg-zinc-800' : 'bg-zinc-900/50'} border border-zinc-800/50 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors ${
                draggedTask?.id === task.id ? 'opacity-50' : ''
              }`}
            >
              <h4 className="text-foreground font-medium text-sm leading-tight">
                {task.title}
              </h4>
              {/* Chips row */}
              <div className="flex flex-wrap gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                {task.status !== 'open' && task.status !== 'inbox' && (
                  <PropertyChip
                    value={task.status}
                    options={STATUS_OPTIONS}
                    onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) }).then(() => fetchData()) }}
                    colorFn={statusColor}
                  />
                )}
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
                    const updates: Record<string, any> = { assigned_to: v || null }
                    // Auto-unblock when reassigning from Cri
                    if (task.status === 'blocked' && task.assigned_to?.toLowerCase() === 'cri' && v && v.toLowerCase() !== 'cri') {
                      updates.status = 'assigned'
                    }
                    fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }).then(() => fetchData())
                  }}
                  searchable
                  align="right"
                  placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}
                />
                {task.project_id && (
                  <PropertyChip
                    value={task.project_id}
                    options={projectChipOptions}
                    onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: v || null }) }).then(() => fetchData()) }}
                  />
                )}
                {task.tags?.slice(0, 2).map((tag, i) => (
                  <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}>{tag}</span>
                ))}
                {(task.tags?.length || 0) > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{task.tags!.length - 2}</span>
                )}
              </div>
            </div>
          )
        }

        const renderColumnHeader = (title: string, count: number) => (
          <div className="py-2 flex justify-between items-center">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
            <span className="text-xs text-muted-foreground/50">{count}</span>
          </div>
        )

        return (
        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {/* Inbox — double width */}
          <div
            className="flex-[2] min-w-80 flex flex-col"
            onDragEnter={(e) => handleDragEnter(e, 'inbox')}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'inbox')}
          >
            {renderColumnHeader('Inbox', inboxTasks.length)}
            <div className="flex-1 space-y-2 min-h-32 overflow-y-auto">
              {inboxTasks.map((task, rowIdx) => renderCard(task, COL_INBOX, rowIdx))}
              {inboxTasks.length === 0 && (
                <div className="text-center text-muted-foreground/50 py-8 text-sm">No tasks in inbox</div>
              )}
            </div>
          </div>

          {/* Middle stack: In Progress (conditional) + Assigned */}
          <div className="flex-1 min-w-72 flex flex-col gap-4">
            {/* In Progress — only shown when non-empty */}
            {inProgressTasks.length > 0 && (
              <div
                className="flex flex-col"
                onDragEnter={(e) => handleDragEnter(e, 'in_progress')}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'in_progress')}
              >
                {renderColumnHeader('In Progress', inProgressTasks.length)}
                <div className="space-y-2">
                  {inProgressTasks.map((task, rowIdx) => renderCard(task, COL_IN_PROGRESS, rowIdx))}
                </div>
              </div>
            )}

            {/* Assigned */}
            <div
              className="flex-1 flex flex-col"
              onDragEnter={(e) => handleDragEnter(e, 'assigned')}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'assigned')}
            >
              {renderColumnHeader('Assigned', assignedTasks.length)}
              <div className="flex-1 space-y-2 min-h-32 overflow-y-auto">
                {assignedTasks.map((task, rowIdx) => renderCard(task, COL_ASSIGNED, rowIdx))}
                {assignedTasks.length === 0 && (
                  <div className="text-center text-muted-foreground/50 py-8 text-sm">No assigned tasks</div>
                )}
              </div>
            </div>
          </div>

          {/* Done */}
          <div
            className="flex-1 min-w-72 flex flex-col"
            onDragEnter={(e) => handleDragEnter(e, 'done')}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'done')}
          >
            {renderColumnHeader('Done', doneTasks.length)}
            <div className="flex-1 space-y-2 min-h-32 overflow-y-auto">
              {doneTasks.map((task, rowIdx) => renderCard(task, COL_DONE, rowIdx))}
              {doneTasks.length === 0 && (
                <div className="text-center text-muted-foreground/50 py-8 text-sm">No done tasks</div>
              )}
            </div>
          </div>
        </div>
        )
      })()
      }

      {/* List View */}
      {viewMode === 'list' && (() => {
        const listSectionsWithLabels = [
          { key: 'blocked', label: 'Blocked', tasks: tasksByStatus['blocked'] || [], rowClass: 'bg-rose-500/5 border-l-2 border-l-rose-500/40' },
          { key: 'review', label: 'Review', tasks: tasksByStatus['review'] || [], rowClass: 'bg-lime-500/5 border-l-2 border-l-lime-500/40' },
          { key: 'quality_review', label: 'Quality Review', tasks: tasksByStatus['quality_review'] || [], rowClass: 'bg-lime-500/5 border-l-2 border-l-lime-500/40' },
          { key: 'in_progress', label: 'In Progress', tasks: tasksByStatus['in_progress'] || [], rowClass: '' },
          { key: 'assigned', label: 'Assigned', tasks: tasksByStatus['assigned'] || [], rowClass: '' },
          { key: 'inbox', label: 'Inbox', tasks: tasksByStatus['inbox'] || [], rowClass: '' },
          { key: 'done', label: 'Done', tasks: tasksByStatus['done'] || [], rowClass: '' },
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
                  <div className="bg-card border border-border rounded-lg overflow-hidden">
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
                          <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{task.title}</span>
                          <div className="flex items-center gap-1.5 sm:shrink-0 sm:justify-end" onClick={e => e.stopPropagation()}>
                            {task.status !== 'open' && task.status !== 'inbox' && (
                              <PropertyChip
                                value={task.status}
                                options={STATUS_OPTIONS}
                                onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) }).then(() => fetchData()) }}
                                colorFn={statusColor}
                              />
                            )}
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
                                const updates: Record<string, any> = { assigned_to: v || null }
                                if (task.status === 'blocked' && task.assigned_to?.toLowerCase() === 'cri' && v && v.toLowerCase() !== 'cri') {
                                  updates.status = 'assigned'
                                }
                                fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }).then(() => fetchData())
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

// --- Status / Priority option configs ---

const STATUS_OPTIONS: PropertyOption[] = [
  { value: 'open', label: 'Open', icon: <Circle width={14} height={14} /> },
  { value: 'in_progress', label: 'In Progress', icon: <HalfMoon width={14} height={14} /> },
  { value: 'review', label: 'Review', icon: <Eye width={14} height={14} /> },
  { value: 'blocked', label: 'Blocked', icon: <Prohibition width={14} height={14} /> },
  { value: 'done', label: 'Done', icon: <CheckCircle width={14} height={14} /> },
]

const PRIORITY_OPTIONS: PropertyOption[] = [
  { value: 'urgent', label: 'Urgent', icon: <WarningTriangle width={14} height={14} /> },
  { value: 'high', label: 'High', icon: <NavArrowUp width={14} height={14} /> },
  { value: 'medium', label: 'Normal', icon: <Minus width={14} height={14} /> },
  { value: 'low', label: 'Low', icon: <NavArrowDown width={14} height={14} /> },
]

function statusColor(value: string): string {
  switch (value) {
    case 'done': return 'text-emerald-500'
    case 'in_progress': return 'text-yellow-400'
    case 'review': return 'text-indigo-400'
    case 'blocked': return 'text-rose-400'
    default: return 'text-muted-foreground'
  }
}

function priorityColor(value: string): string {
  switch (value) {
    case 'urgent': return 'bg-orange-500/15 text-orange-400'
    case 'high': return 'bg-red-500/15 text-red-400'
    case 'medium': return 'bg-yellow-500/15 text-yellow-400'
    case 'low': return 'bg-green-500/15 text-green-400'
    default: return 'bg-surface-1 text-muted-foreground'
  }
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

  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Array<{ url: string; filename: string; originalName?: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setCommentText('')
    setCommentError(null)

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
    // Auto-unblock: if task is blocked and assignee changes from Cri to someone else, unblock it
    if (status === 'blocked' && assignee.toLowerCase() === 'cri' && v.toLowerCase() !== 'cri' && v !== '') {
      setStatus('assigned' as any)
      saveField('assigned_to', v).then(() => saveField('status', 'assigned'))
      return
    }
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

  useEffect(() => { fetchComments() }, [fetchComments])
  useSmartPoll(fetchComments, 15000)

  const deleteComment = async (commentId: number) => {
    try {
      await fetch(`/api/tasks/${task.id}/comments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId: String(commentId) }) })
      fetchComments()
    } catch { setCommentError('Failed to delete comment') }
  }

  const saveEditComment = async (commentId: number) => {
    if (!editingCommentText.trim()) return
    try {
      await fetch(`/api/tasks/${task.id}/comments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId: String(commentId), content: editingCommentText.trim() }) })
      setEditingCommentId(null)
      fetchComments()
    } catch { setCommentError('Failed to edit comment') }
  }

  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const imageFiles = fileArray.filter(f => f.type.startsWith('image/'))

    if (imageFiles.length === 0) return

    // Validate file size (10MB max)
    const invalidFiles = imageFiles.filter(f => f.size > 10 * 1024 * 1024)
    if (invalidFiles.length > 0) {
      setCommentError(`Some files are too large (max 10MB): ${invalidFiles.map(f => f.name).join(', ')}`)
      return
    }

    setUploading(true)
    setCommentError(null)

    try {
      const uploadPromises = imageFiles.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/uploads', {
          method: 'POST',
          body: formData
        })
        if (!res.ok) throw new Error('Upload failed')
        return await res.json()
      })

      const results = await Promise.all(uploadPromises)
      setAttachments(prev => [...prev, ...results])
    } catch (error) {
      setCommentError('Failed to upload images')
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = (filename: string) => {
    setAttachments(prev => prev.filter(a => a.filename !== filename))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()
    const files = imageItems.map(item => item.getAsFile()).filter((f): f is File => f !== null)
    if (files.length > 0) {
      handleFileUpload(files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      handleFileUpload(files)
    }
  }

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim() && attachments.length === 0) return
    try {
      setCommentError(null)
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: 'cri',
          content: commentText,
          attachments: attachments.length > 0 ? attachments : undefined
        })
      })
      if (!response.ok) throw new Error('Failed to add comment')
      setCommentText('')
      setAttachments([])
      await fetchComments()
      onUpdate()
    } catch { setCommentError('Failed to add comment') }
  }

  const authorColor = (name: string) => {
    const n = name.toLowerCase()
    if (n === 'cri' || n === 'cristiano') return 'text-pink-400'
    if (n === 'cseno' || n === 'bot') return 'text-lime-400'
    if (n === 'cody') return 'text-blue-400'
    if (n === 'bookworm') return 'text-purple-400'
    return 'text-foreground/80'
  }

  const renderComment = (comment: Comment, depth: number = 0) => (
    <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''} group/comment`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className={`font-semibold ${authorColor(comment.author)}`}>{comment.author}</span>
        <div className="flex items-center gap-1">
          <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
          <div className="hidden group-hover/comment:flex items-center gap-0.5 ml-1">
            <Button variant="ghost" size="icon-xs" className="h-5 w-5 text-muted-foreground/40 hover:text-muted-foreground" onClick={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.content) }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </Button>
            <Button variant="ghost" size="icon-xs" className="h-5 w-5 text-muted-foreground/40 hover:text-red-400" onClick={() => deleteComment(comment.id)}>
              <Xmark width={12} height={12} />
            </Button>
          </div>
        </div>
      </div>
      {editingCommentId === comment.id ? (
        <div className="mt-1 flex gap-1.5">
          <input className="flex-1 text-sm bg-zinc-900 border border-border rounded px-2 py-1 text-foreground" value={editingCommentText} onChange={e => setEditingCommentText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEditComment(comment.id); if (e.key === 'Escape') setEditingCommentId(null) }} autoFocus />
          <Button size="xs" onClick={() => saveEditComment(comment.id)}>Save</Button>
          <Button size="xs" variant="ghost" onClick={() => setEditingCommentId(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{comment.content}</div>
      )}
      {comment.attachments && comment.attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {comment.attachments.map((attachment) => (
            <img
              key={attachment.filename}
              src={attachment.url}
              alt={attachment.originalName || attachment.filename}
              className="max-h-[200px] rounded border border-border object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setLightboxImage(attachment.url)}
            />
          ))}
        </div>
      )}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  )

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
            <PropertyChip value={status} options={STATUS_OPTIONS} onSelect={handleStatusChange} colorFn={statusColor} />
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
            <Badge variant="secondary" size="sm" className="ml-auto" title={new Date(task.created_at * 1000).toLocaleString()}>
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

          {/* Comments */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">Comments</h4>
              <Button variant="ghost" size="xs" onClick={fetchComments} className="text-muted-foreground/40 hover:text-muted-foreground">Refresh</Button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-xs mb-3">{commentError}</div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-xs py-2">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/40 text-xs py-2">No comments yet.</div>
            ) : (
              <div className="space-y-3">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer: comment input */}
        <div className="shrink-0 px-4 py-3 border-t border-border">
          <form onSubmit={handleAddComment}>
            <div
              className={`flex flex-col gap-2 ${isDragging ? 'bg-primary/10 rounded-lg' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {attachments.map((attachment) => (
                    <div key={attachment.filename} className="relative group">
                      <img
                        src={attachment.url}
                        alt={attachment.originalName || attachment.filename}
                        className="h-16 rounded border border-border object-cover"
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeAttachment(attachment.filename)}
                        className="absolute -top-1 -right-1 bg-card/90 hover:bg-destructive/90 text-foreground hover:text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                        type="button"
                      >
                        <Xmark className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  {uploading && (
                    <div className="h-16 w-16 rounded border border-border bg-surface-1 flex items-center justify-center">
                      <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  )}
                </div>
              )}

              {/* Input row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Write a comment..."
                  className="flex-1 bg-surface-1 text-foreground text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(e) } }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => e.target.files && handleFileUpload(e.target.files)}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image"
                  disabled={uploading}
                >
                  <Attachment className="w-4 h-4" />
                </Button>
                <Button type="submit" disabled={uploading}>Send</Button>
              </div>

              {commentError && (
                <p className="text-xs text-destructive">{commentError}</p>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Lightbox for full-size image viewing */}
      {lightboxImage && (
        <Lightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
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
