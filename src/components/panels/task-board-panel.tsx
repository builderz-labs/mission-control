'use client'

import { memo, useState, useEffect, useCallback, useMemo, useRef, type DragEvent } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { computeTaskProgress, formatTaskTimeRemaining } from '@/lib/task-progress'
import { TodoSyncModal } from './todo-sync-modal'

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

function getTagColor(tag: string) {
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

function getAutonomousTaskSignals(task: Task) {
  const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object' ? metadata.autonomous : {}
  const verification = metadata.verification && typeof metadata.verification === 'object' ? metadata.verification : {}
  const debateReason = typeof autonomous.last_debate_summary === 'string' && autonomous.last_debate_summary
    ? autonomous.last_debate_summary
    : typeof autonomous.last_failure_reason === 'string' && autonomous.last_failure_reason
    ? autonomous.last_failure_reason
    : typeof verification.reason === 'string' && verification.reason
    ? verification.reason
    : ''

  return {
    debatePending: autonomous.debate_pending === true,
    debateRounds: Number(autonomous.debate_rounds || 0),
    debateReason,
    selfHealActions: Number(autonomous.self_heal_actions || 0),
    lastSelfHealAt: Number(autonomous.last_self_heal_at || 0),
  }
}

const TaskCard = memo(function TaskCard({
  task,
  agentName,
  isDragged,
  createdLabel,
  updatedLabel,
  dueLabel,
  selfHealLabel,
  progressPct,
  timeRemaining,
  autonomous,
  onDragStart,
  onSelect,
  onOpenDetail,
}: {
  task: Task
  agentName: string
  isDragged: boolean
  createdLabel: string
  updatedLabel?: string
  dueLabel?: string
  selfHealLabel?: string
  progressPct: number
  timeRemaining: string
  autonomous: ReturnType<typeof getAutonomousTaskSignals>
  onDragStart: (event: DragEvent, task: Task) => void
  onSelect: (task: Task) => void
  onOpenDetail: (task: Task) => void
}) {
  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onSelect(task)}
      onDoubleClick={() => onOpenDetail(task)}
      className={`bg-surface-1 rounded-xl p-2.5 cursor-pointer hover:bg-surface-2 transition-smooth border border-border/60 border-l-4 ${priorityColors[task.priority]} ${
        isDragged ? 'opacity-50' : ''
      }`}
    >
      <div className="flex justify-between items-start mb-1.5 gap-2">
        <h4 className="text-foreground font-medium text-xs leading-tight">
          {task.title}
        </h4>
        <div className="flex items-center gap-2">
          {task.aegisApproved && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-700 text-emerald-100">
              Aegis
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            task.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
            task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
            task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-green-500/20 text-green-400'
          }`}>
            {task.priority}
          </span>
        </div>
      </div>

      {task.description && (
        <p className="text-foreground/75 text-[11px] mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      {(autonomous.debatePending || autonomous.selfHealActions > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {autonomous.debatePending && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              Debate pending
            </span>
          )}
          {autonomous.debateRounds > 0 && (
            <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
              Debate r{autonomous.debateRounds}
            </span>
          )}
          {autonomous.selfHealActions > 0 && (
            <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
              Self-heal x{autonomous.selfHealActions}
            </span>
          )}
        </div>
      )}

      {autonomous.debateReason && (
        <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-200/90 line-clamp-3">
          {autonomous.debateReason}
        </div>
      )}

      {task.status !== 'done' && (
        <div className="mb-2.5 rounded-lg border border-border/50 bg-background/60 px-2 py-2">
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
            <span>Progress</span>
            <span className="text-yellow-400 font-semibold">{progressPct}%</span>
          </div>
          <div className="w-full bg-background rounded-full h-1.5 overflow-hidden border border-border">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 to-orange-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 text-[9px] text-muted-foreground">
            {timeRemaining}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center text-[10px] text-muted-foreground">
        <span className="truncate max-w-[95px]">{agentName}</span>
        <span className="font-medium">{createdLabel}</span>
      </div>

      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.tags.slice(0, 3).map((tag, index) => (
            <span
              key={index}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-muted-foreground text-xs font-medium">+{task.tags.length - 3}</span>
          )}
        </div>
      )}

      {updatedLabel && (
        <div className="text-[10px] text-muted-foreground/70 mt-1">
          Updated {updatedLabel}
        </div>
      )}

      {autonomous.lastSelfHealAt > 0 && (
        <div className="text-[10px] text-cyan-300/80 mt-1">
          Self-healed {selfHealLabel || createdLabel}
        </div>
      )}

      {dueLabel && (
        <div className="mt-1.5 text-[10px]">
          <span className={`${
            task.due_date && task.due_date * 1000 < Date.now() ? 'text-red-400' : 'text-yellow-400'
          }`}>
            Due: {dueLabel}
          </span>
        </div>
      )}
    </div>
  )
})

export function TaskBoardPanel() {
  const {
    selectedTask,
    setSelectedTask,
    setTasks: setStoreTasks,
    setAgents: setStoreAgents,
    setRuntimeSignal,
    clearRuntimeSignal,
  } = useMissionControl()
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showTodoSync, setShowTodoSync] = useState(false)
  const dragCounter = useRef(0)
  const taskFetchRoundRef = useRef(0)
  const bootstrapWarnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch tasks and agents
  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    const isBootstrapLoad = !silent && tasks.length === 0
    const round = isBootstrapLoad ? taskFetchRoundRef.current + 1 : taskFetchRoundRef.current

    if (isBootstrapLoad) {
      taskFetchRoundRef.current = round
      setRuntimeSignal({
        id: 'tasks.bootstrap',
        message: 'Loading tasks',
        detail: `connecting to API · round ${round}`,
        tone: 'info',
        priority: 115,
      })
      if (bootstrapWarnTimeoutRef.current) clearTimeout(bootstrapWarnTimeoutRef.current)
      bootstrapWarnTimeoutRef.current = setTimeout(() => {
        setRuntimeSignal({
          id: 'tasks.bootstrap',
          message: 'Loading tasks is taking longer than expected',
          detail: `still waiting for API · 6s+ · round ${round}`,
          tone: 'warn',
          priority: 115,
        })
      }, 6000)
    }

    try {
      if (!silent) setLoading(true)
      setError(null)

      const [tasksResponse, agentsResponse] = await Promise.all([
        fetch('/api/tasks?limit=100'),
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

      const enrichedTasks = tasksList.map((task: Task) => ({
        ...task,
        aegisApproved: Boolean(aegisMap[task.id])
      }))

      setTasks(enrichedTasks)
      setAgents(agentsData.agents || [])
      setStoreTasks(enrichedTasks as any)
      setStoreAgents((agentsData.agents || []) as any)
      if (isBootstrapLoad) {
        if (bootstrapWarnTimeoutRef.current) {
          clearTimeout(bootstrapWarnTimeoutRef.current)
          bootstrapWarnTimeoutRef.current = null
        }
        clearRuntimeSignal('tasks.bootstrap')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      if (isBootstrapLoad) {
        if (bootstrapWarnTimeoutRef.current) {
          clearTimeout(bootstrapWarnTimeoutRef.current)
          bootstrapWarnTimeoutRef.current = null
        }
        setRuntimeSignal({
          id: 'tasks.bootstrap',
          message: 'Loading tasks failed',
          detail: `${message} · round ${round}`,
          tone: 'error',
          priority: 115,
        })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [clearRuntimeSignal, setRuntimeSignal, setStoreAgents, setStoreTasks, tasks.length])

  useEffect(() => {
    return () => {
      if (bootstrapWarnTimeoutRef.current) {
        clearTimeout(bootstrapWarnTimeoutRef.current)
      }
      clearRuntimeSignal('tasks.bootstrap')
    }
  }, [clearRuntimeSignal])

  // Initial load + background refresh so progression reflects backend state changes.
  useSmartPoll(() => fetchData({ silent: tasks.length > 0 }), 15000, {
    pauseWhenSseConnected: true,
  })

  // Group tasks by status
  const tasksByStatus = useMemo(() => statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>), [tasks])

  // Drag and drop handlers
  const handleDragStart = useCallback((e: DragEvent, task: Task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML)
  }, [])

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task as any)
  }, [setSelectedTask])

  const handleOpenDetail = useCallback((task: Task) => {
    setDetailTask(task)
  }, [])

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

  // Get agent name by session key
  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  useEffect(() => {
    if (!selectedTask) return
    const latest = tasks.find(t => t.id === selectedTask.id) || null
    if (!latest) {
      setSelectedTask(null)
      return
    }
    if (latest !== selectedTask) setSelectedTask(latest as any)
  }, [tasks, selectedTask, setSelectedTask])

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
      <div className="flex justify-between items-center px-4 py-3 border-b border-border flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Task Board</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Compact queue view for up to 100 tasks</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTodoSync(true)}
            className="px-3 py-1.5 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth text-xs font-medium"
            title="Import tasks from todo.md files"
          >
            Sync Todo.md
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-xs font-medium"
          >
            + New Task
          </button>
          <button
            onClick={() => fetchData()}
            className="px-3 py-1.5 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth text-xs font-medium"
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
      <div className="flex-1 px-3 py-3 overflow-hidden">
        <div className="h-full flex gap-3 overflow-x-auto overflow-y-hidden pb-2">
          {statusColumns.map(column => (
            <div
              key={column.key}
              className="w-[210px] flex-shrink-0 bg-card border border-border rounded-xl flex flex-col shadow-sm"
              onDragEnter={(e) => handleDragEnter(e, column.key)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.key)}
            >
              {/* Column Header */}
              <div className={`${column.color} px-3 py-2 rounded-t-xl flex justify-between items-center`}>
                <h3 className="text-sm font-semibold">{column.title}</h3>
                <span className="text-xs bg-black/20 px-2 py-0.5 rounded-full">
                  {tasksByStatus[column.key]?.length || 0}
                </span>
              </div>

              {/* Column Body */}
              <div className="flex-1 p-2.5 space-y-2 min-h-32 overflow-y-auto">
                {tasksByStatus[column.key]?.map(task => {
                  const autonomous = getAutonomousTaskSignals(task)
                  const progressPct = computeTaskProgress(task)
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agentName={getAgentName(task.assigned_to)}
                      isDragged={draggedTask?.id === task.id}
                      createdLabel={formatTaskTimestamp(task.created_at)}
                      updatedLabel={task.updated_at && task.updated_at !== task.created_at ? formatTaskTimestamp(task.updated_at) : undefined}
                      dueLabel={task.due_date ? formatTaskTimestamp(task.due_date) : undefined}
                      selfHealLabel={autonomous.lastSelfHealAt > 0 ? formatTaskTimestamp(autonomous.lastSelfHealAt) : undefined}
                      progressPct={progressPct}
                      timeRemaining={formatTaskTimeRemaining(task)}
                      autonomous={autonomous}
                      onDragStart={handleDragStart}
                      onSelect={handleSelectTask}
                      onOpenDetail={handleOpenDetail}
                    />
                  )
                })}

                {/* Empty State */}
                {tasksByStatus[column.key]?.length === 0 && (
                  <div className="text-center text-muted-foreground/50 py-8 text-xs">
                    No tasks in {column.title.toLowerCase()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Task Detail Modal */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          agents={agents}
          onClose={() => setDetailTask(null)}
          onUpdate={fetchData}
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
      {showTodoSync && (
        <TodoSyncModal
          onClose={() => setShowTodoSync(false)}
          onImported={() => { fetchData() }}
        />
      )}
    </div>
  )
}

// Task Detail Modal Component (placeholder - would be implemented separately)
function TaskDetailModal({ 
  task, 
  agents, 
  onClose, 
  onUpdate 
}: { 
  task: Task
  agents: Agent[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('system')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality'>('details')
  const [reviewer, setReviewer] = useState('aegis')
  const [aiFixLoading, setAiFixLoading] = useState(false)
  const [aiFixError, setAiFixError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null)
  const [localAssigned, setLocalAssigned] = useState(task.assigned_to || '')
  const [localStatus, setLocalStatus] = useState(task.status)

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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-bold text-foreground">{task.title}</h3>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-2xl transition-smooth"
            >
              ×
            </button>
          </div>
          <p className="text-foreground/80 mb-4">{task.description || 'No description'}</p>
          <div className="flex gap-2 mt-4">
            {(['details', 'comments', 'quality'] as const).map(tab => (
              <button
                key={tab}
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
            <div className="mt-4 space-y-4">
              {/* Assign + Status row */}
              <div className="bg-surface-1/40 border border-border rounded-lg p-4 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assignment</h4>

                {/* Assign to agent */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted-foreground w-24 shrink-0">Assign to</label>
                  <select
                    value={localAssigned}
                    onChange={e => setLocalAssigned(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                  >
                    <option value="">— Unassigned —</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.name}>
                        {a.name} ({a.status})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status picker */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted-foreground w-24 shrink-0">Status</label>
                  <select
                    value={localStatus}
                    onChange={e => setLocalStatus(e.target.value as Task['status'])}
                    className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                  >
                    {(['inbox','assigned','in_progress','review','quality_review','done'] as const).map(s => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>

                {/* Save button */}
                <div className="flex items-center justify-between pt-1">
                  {assignFeedback && (
                    <span className={`text-xs ${assignFeedback.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {assignFeedback}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      setAssigning(true)
                      setAssignFeedback(null)
                      const nextStatus = localAssigned && localStatus === 'inbox' ? 'assigned' : localStatus
                      try {
                        const res = await fetch(`/api/tasks/${task.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            assigned_to: localAssigned || null,
                            status: nextStatus
                          })
                        })
                        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
                        setLocalStatus(nextStatus)
                        setAssignFeedback('✓ Saved')
                        onUpdate()
                        setTimeout(() => setAssignFeedback(null), 2500)
                      } catch (err: any) {
                        setAssignFeedback('✗ ' + err.message)
                      } finally {
                        setAssigning(false)
                      }
                    }}
                    disabled={assigning}
                    className="ml-auto px-4 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-50 transition-colors"
                  >
                    {assigning ? 'Saving...' : 'Save Assignment'}
                  </button>
                </div>
              </div>

              {/* Read-only meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-surface-1/20 rounded-md px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-0.5">Priority</div>
                  <span className={`font-medium ${
                    task.priority === 'urgent' ? 'text-red-400' :
                    task.priority === 'high' ? 'text-orange-400' :
                    task.priority === 'medium' ? 'text-yellow-400' : 'text-muted-foreground'
                  }`}>{task.priority}</span>
                </div>
                <div className="bg-surface-1/20 rounded-md px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-0.5">Created</div>
                  <span className="text-foreground">{new Date(task.created_at * 1000).toLocaleDateString()}</span>
                </div>
                <div className="bg-surface-1/20 rounded-md px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-0.5">Created by</div>
                  <span className="text-foreground">{task.created_by || '—'}</span>
                </div>
                <div className="bg-surface-1/20 rounded-md px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-0.5">Updated</div>
                  <span className="text-foreground">{new Date(task.updated_at * 1000).toLocaleDateString()}</span>
                </div>
                {task.tags && task.tags.length > 0 && (
                  <div className="col-span-2 bg-surface-1/20 rounded-md px-3 py-2">
                    <div className="text-xs text-muted-foreground mb-1">Tags</div>
                    <div className="flex flex-wrap gap-1">
                      {task.tags.map(tag => (
                        <span key={tag} className={`text-xs px-1.5 py-0.5 rounded border ${getTagColor(tag)}`}>{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-foreground">Comments</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setAiFixLoading(true)
                    setAiFixError(null)
                    try {
                      const res = await fetch(`/api/tasks/${task.id}/ai-fix`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'AI fix failed')
                      await fetchComments()
                    } catch (err: any) { setAiFixError(err.message) }
                    finally { setAiFixLoading(false) }
                  }}
                  disabled={aiFixLoading}
                  className="text-xs px-2 py-1 rounded bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 border border-violet-500/30 transition-colors disabled:opacity-50 font-medium"
                  title="Ask Claude Haiku to analyze and suggest a fix (saves tokens)"
                >
                  {aiFixLoading ? '...' : '🤖 Ask Claude'}
                </button>
                <button onClick={fetchComments} className="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
              </div>
            </div>
            {aiFixError && <div className="text-xs text-red-400 mb-2">{aiFixError}</div>}

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
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Author</label>
                <input
                  type="text"
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">New Comment</label>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={3}
                />
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

            <div className="mt-6 border-t border-border pt-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Broadcast to Subscribers</h5>
              {broadcastStatus && (
                <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <textarea
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={2}
                  placeholder="Send a message to all task subscribers..."
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
            <div className="mt-6">
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
      const nextStatus = formData.assigned_to ? 'assigned' : 'inbox'
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          status: nextStatus,
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
