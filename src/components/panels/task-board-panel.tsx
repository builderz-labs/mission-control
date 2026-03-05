'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Circle, HalfMoon, CheckCircle, Prohibition, WarningTriangle,
  NavArrowUp, Minus, NavArrowDown, Eye,
} from 'iconoir-react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { PropertyChip, type PropertyOption } from '@/components/ui/property-chip'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { BlockEditor } from '@/components/ui/block-editor'

interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
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

const statusColumns = [
  { key: 'inbox', title: 'Inbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
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
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [tasksResponse, agentsResponse] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents')
      ])

      if (!tasksResponse.ok || !agentsResponse.ok) {
        throw new Error('Failed to fetch data')
      }

      const tasksData = await tasksResponse.json()
      const agentsData = await agentsResponse.json()

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

      setTasks(
        tasksList.map((task: Task) => ({
          ...task,
          aegisApproved: Boolean(aegisMap[task.id])
        }))
      )
      setAgents(agentsData.agents || [])
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

  // Flat task list for list view
  const allTasks = tasks

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

        if (e.key === 'Enter' && focusedListIndex !== null) {
          if (allTasks[focusedListIndex]) setSelectedTask(allTasks[focusedListIndex])
          return
        }

        if (focusedListIndex === null) { setFocusedListIndex(0); return }

        if (e.key === 'ArrowDown') {
          setFocusedListIndex(Math.min(focusedListIndex + 1, allTasks.length - 1))
        } else if (e.key === 'ArrowUp') {
          setFocusedListIndex(Math.max(focusedListIndex - 1, 0))
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [viewMode, focusedIndex, focusedListIndex, selectedTask, showCreateModal, allTasks])

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

  // Group tasks by status
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => (task as any).column === column.key || task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>)
  tasksByStatusRef.current = tasksByStatus

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
        <h2 className="text-xl font-bold text-foreground">Task Board</h2>
        <div className="flex gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => { setViewMode('kanban'); setFocusedListIndex(null) }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'kanban' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Board
            </button>
            <button
              onClick={() => { setViewMode('list'); setFocusedIndex(null) }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              List
            </button>
          </div>
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
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            ×
          </button>
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
              className={`${isFocused ? 'bg-zinc-800' : 'bg-zinc-900'} border border-zinc-800/50 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors ${
                draggedTask?.id === task.id ? 'opacity-50' : ''
              }`}
            >
              <h4 className="text-foreground font-medium text-sm leading-tight">
                {task.title}
              </h4>
              {/* Chips row */}
              <div className="flex flex-wrap gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                <PropertyChip
                  value={task.status}
                  options={STATUS_OPTIONS}
                  onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) }).then(() => fetchData()) }}
                  colorFn={statusColor}
                />
                <PropertyChip
                  value={task.priority}
                  options={PRIORITY_OPTIONS}
                  onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: v }) }).then(() => fetchData()) }}
                  colorFn={priorityColor}
                />
                <PropertyChip
                  value={task.assigned_to || ''}
                  options={assigneeOptions}
                  onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_to: v || null }) }).then(() => fetchData()) }}
                  searchable
                  align="right"
                  placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}
                />
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
        const listSections = [
          { key: 'inbox', label: 'Inbox', tasks: tasksByStatus['inbox'] || [] },
          { key: 'assigned', label: 'Assigned', tasks: tasksByStatus['assigned'] || [] },
          { key: 'in_progress', label: 'In Progress', tasks: tasksByStatus['in_progress'] || [] },
          { key: 'done', label: 'Done', tasks: tasksByStatus['done'] || [] },
        ].filter(s => s.tasks.length > 0)

        // Build flat index → task mapping for keyboard nav
        let flatIdx = 0
        const flatMap: { task: Task; idx: number }[] = []
        listSections.forEach(section => {
          section.tasks.forEach(task => {
            flatMap.push({ task, idx: flatIdx++ })
          })
        })

        return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {flatMap.length === 0 ? (
            <div className="text-center text-muted-foreground/50 py-8 text-sm">No tasks</div>
          ) : (
            listSections.map(section => {
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
                          className={`flex items-center justify-between gap-4 px-4 py-2.5 border-b border-zinc-800/50 last:border-b-0 cursor-pointer hover:bg-zinc-800 transition-colors ${
                            isFocused ? 'bg-zinc-800' : ''
                          }`}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{task.title}</span>
                          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                            <PropertyChip
                              value={task.status}
                              options={STATUS_OPTIONS}
                              onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) }).then(() => fetchData()) }}
                              colorFn={statusColor}
                            />
                            <PropertyChip
                              value={task.priority}
                              options={PRIORITY_OPTIONS}
                              onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: v }) }).then(() => fetchData()) }}
                              colorFn={priorityColor}
                            />
                            <PropertyChip
                              value={task.assigned_to || ''}
                              options={assigneeOptions}
                              onSelect={(v) => { fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_to: v || null }) }).then(() => fetchData()) }}
                              searchable
                              align="right"
                              placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}
                            />
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
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onUpdate={fetchData}
          onNavigate={(task) => setSelectedTask(task)}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          agents={agents}
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
    case 'done': return 'bg-green-500/15 text-green-400'
    case 'in_progress': return 'bg-yellow-500/15 text-yellow-400'
    case 'review': return 'bg-purple-500/15 text-purple-400'
    case 'blocked': return 'bg-red-500/15 text-red-400'
    default: return 'bg-surface-1 text-muted-foreground'
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
  allTasks = [],
  onClose,
  onUpdate,
  onNavigate,
}: {
  task: Task
  agents: Agent[]
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
  const [creator, setCreator] = useState((task as any).creator || '')

  // Navigation
  const currentIndex = allTasks.findIndex(t => t.id === task.id)
  const prevTask = currentIndex > 0 ? allTasks[currentIndex - 1] : null
  const nextTask = currentIndex < allTasks.length - 1 ? allTasks[currentIndex + 1] : null

  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)

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
    setCreator((task as any).creator || '')
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
  const handleAssigneeChange = (v: string) => { setAssignee(v); saveField('assigned_to', v) }
  const handleCreatorChange = (v: string) => { setCreator(v); saveField('creator', v) }

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (title.trim() && title !== task.title) saveField('title', title.trim())
    else if (!title.trim()) setTitle(task.title)
  }

  const handleDescriptionSave = (markdown: string) => {
    const trimmed = markdown.trim()
    if (trimmed !== (task.description || '').trim()) {
      setDescription(trimmed)
      saveField('description', trimmed)
    }
  }

  const handleClose = () => { onUpdate(); onClose() }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      onUpdate()
      onClose()
    } catch (e) { console.error('Failed to delete task', e) }
  }

  // Build assignee options (detail modal)
  const detailAssigneeOptions: PropertyOption[] = [
    { value: '', label: 'Unassigned', icon: '—' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> as React.ReactNode, group: 'Humans' },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode, group: 'Agents',
    })),
  ]
  const creatorOptions: PropertyOption[] = [
    { value: '', label: 'Unknown', icon: '—' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> as React.ReactNode },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode,
    })),
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

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      setCommentError(null)
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'cri', content: commentText })
      })
      if (!response.ok) throw new Error('Failed to add comment')
      setCommentText('')
      await fetchComments()
      onUpdate()
    } catch { setCommentError('Failed to add comment') }
  }

  const authorColor = (name: string) => {
    const n = name.toLowerCase()
    if (n === 'cri' || n === 'cristiano') return 'text-pink-400'
    if (n === 'cseno' || n === 'userboy' || n === 'bot') return 'text-lime-400'
    if (n === 'cody') return 'text-blue-400'
    if (n === 'bookworm') return 'text-purple-400'
    return 'text-foreground/80'
  }

  const renderComment = (comment: Comment, depth: number = 0) => (
    <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className={`font-semibold ${authorColor(comment.author)}`}>{comment.author}</span>
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Fixed Header: nav + title + chips */}
        <div className="shrink-0 p-6 pb-4 border-b border-border">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              {saving && <span className="text-[10px] text-muted-foreground/50">Saving...</span>}
              <span className="text-[10px] text-muted-foreground/40">{new Date(task.created_at * 1000).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1">
              {onNavigate && (
                <>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    onClick={() => prevTask && onNavigate(prevTask)}
                    disabled={!prevTask}
                    title="Previous task (↑)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    onClick={() => nextTask && onNavigate(nextTask)}
                    disabled={!nextTask}
                    title="Next task (↓)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                  </Button>
                </>
              )}
              <Button variant="outline" size="icon-xs" onClick={handleClose} title="Close (Esc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
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
            <PropertyChip value={priority} options={PRIORITY_OPTIONS} onSelect={handlePriorityChange} colorFn={priorityColor} />
            <PropertyChip value={assignee} options={detailAssigneeOptions} onSelect={handleAssigneeChange} searchable label="Assignee" placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>} />
            <PropertyChip value={creator} options={creatorOptions} onSelect={handleCreatorChange} label="Creator" readOnly />
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
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
              <button onClick={fetchComments} className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground">Refresh</button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-xs mb-3">{commentError}</div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-xs py-2">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/40 text-xs py-2">No comments yet.</div>
            ) : (
              <div className="space-y-3 mb-3">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 bg-surface-1 text-foreground text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(e) } }}
                />
                <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-xs font-medium">Send</button>
              </div>
            </form>

            {/* Delete */}
            <div className="border-t border-border pt-4 mt-4 flex justify-end">
              <button
                onClick={handleDelete}
                onMouseLeave={() => setConfirmDelete(false)}
                className={`text-[11px] px-3 py-1.5 rounded-md transition-smooth font-medium ${
                  confirmDelete
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10'
                }`}
              >
                {confirmDelete ? 'Click again to confirm delete' : 'Delete task'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Create Task Modal Component (placeholder)
function CreateTaskModal({ 
  agents, 
  onClose, 
  onCreated 
}: { 
  agents: Agent[]
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    assigned_to: '',
    tags: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined
        })
      })

      if (!response.ok) throw new Error('Failed to create task')
      
      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating task:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-foreground mb-4">Create New Task</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                rows={3}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Assign to</label>
                <select
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
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
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
