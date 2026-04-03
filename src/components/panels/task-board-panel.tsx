'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

import { createClientLogger } from '@/lib/client-logger'

import { useFocusTrap } from '@/lib/use-focus-trap'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Button } from '@/components/ui/button'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { SessionMessage, shouldShowTimestamp, type SessionTranscriptMessage } from '@/components/chat/session-message'

const log = createClientLogger('TaskBoard')

interface Task {
  id: number
  title: string
  description?: string
  status: 'backlog' | 'inbox' | 'assigned' | 'awaiting_owner' | 'in_progress' | 'review' | 'quality_review' | 'done' | 'failed'
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
  github_issue_number?: number
  github_repo?: string
  github_branch?: string
  github_pr_number?: number
  github_pr_state?: string
  comment_count?: number
  error_message?: string
  dispatch_attempts?: number
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

const STATUS_COLUMN_KEYS = [
  { key: 'backlog', titleKey: 'colBacklog', color: 'bg-slate-500/20 text-slate-400' },
  { key: 'inbox', titleKey: 'colInbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', titleKey: 'colAssigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'awaiting_owner', titleKey: 'colAwaitingOwner', color: 'bg-orange-500/20 text-orange-400' },
  { key: 'in_progress', titleKey: 'colInProgress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', titleKey: 'colReview', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', titleKey: 'colQualityReview', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'done', titleKey: 'colDone', color: 'bg-green-500/20 text-green-400' },
  { key: 'failed', titleKey: 'colFailed', color: 'bg-red-500/20 text-red-400' },
]

const AWAITING_OWNER_KEYWORDS = [
  'waiting for', 'waiting on', 'needs human', 'manual action',
  'account creation', 'browser login', 'approval needed',
  'owner action', 'human required', 'blocked on owner',
  'awaiting owner', 'awaiting human', 'needs owner',
]

function detectAwaitingOwner(task: Task): boolean {
  if (task.status === 'awaiting_owner') return true
  if (task.status !== 'assigned' && task.status !== 'in_progress') return false
  const text = `${task.title} ${task.description || ''}`.toLowerCase()
  return AWAITING_OWNER_KEYWORDS.some(kw => text.includes(kw))
}

/** Build a human-readable label for a session key like "agent:nefes:telegram-group-123" */
function formatSessionLabel(s: { key: string; channel?: string; kind?: string; label?: string }): string {
  if (s.label) return s.label
  // Extract the identifier part after the last colon: "agent:name:main" → "main"
  const parts = (s.key || '').split(':')
  const identifier = parts.length > 2 ? parts.slice(2).join(':') : s.key
  const channel = s.channel || ''
  if (channel && identifier !== 'main') {
    return `${channel} (${identifier})`
  }
  if (channel) return `${channel} (${s.kind || 'default'})`
  return identifier || s.key
}

/** Fetch active gateway sessions for a given agent name. */
function useAgentSessions(agentName: string | undefined) {
  const [sessions, setSessions] = useState<Array<{ key: string; id: string; channel?: string; kind?: string; label?: string; displayLabel: string }>>([])
  useEffect(() => {
    if (!agentName) { setSessions([]); return }
    let cancelled = false
    fetch('/api/sessions')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const all = (data.sessions || []) as Array<{ key: string; id: string; agent?: string; channel?: string; kind?: string; label?: string; active?: boolean }>
        const filtered = all.filter(s =>
          s.agent?.toLowerCase() === agentName.toLowerCase() ||
          s.key?.toLowerCase().includes(agentName.toLowerCase())
        )
        setSessions(filtered.map(s => ({
          key: s.key,
          id: s.id,
          channel: s.channel,
          kind: s.kind,
          label: s.label,
          displayLabel: formatSessionLabel(s),
        })))
      })
      .catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
  }, [agentName])
  return sessions
}

const priorityColors: Record<string, string> = {
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
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

type DunkPhase = 'idle' | 'success' | 'error' | 'dismissing'

function DunkItButton({ taskId, onDunked }: { taskId: number; onDunked: (id: number) => void }) {
  const t = useTranslations('taskBoard')
  const [phase, setPhase] = useState<DunkPhase>('idle')

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (phase !== 'idle') return
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      if (!res.ok) throw new Error('Failed')
      setPhase('success')
      setTimeout(() => {
        setPhase('dismissing')
        setTimeout(() => onDunked(taskId), 400)
      }, 600)
    } catch {
      setPhase('error')
      setTimeout(() => setPhase('idle'), 1500)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={phase !== 'idle' && phase !== 'error'}
      title={t('dunkIt')}
      style={{
        padding: '2px 8px',
        fontSize: '11px',
        borderRadius: '4px',
        border: '1px solid',
        cursor: phase === 'idle' ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        transform: phase === 'success' ? 'scale(1.15)' : phase === 'dismissing' ? 'scale(0.8) translateY(-10px)' : 'scale(1)',
        opacity: phase === 'dismissing' ? 0 : 1,
        borderColor: phase === 'success' ? 'rgb(34 197 94 / 0.5)' : phase === 'error' ? 'rgb(239 68 68 / 0.5)' : 'hsl(var(--border))',
        backgroundColor: phase === 'success' ? 'rgb(34 197 94 / 0.15)' : phase === 'error' ? 'rgb(239 68 68 / 0.15)' : 'transparent',
        color: phase === 'success' ? 'rgb(34 197 94)' : phase === 'error' ? 'rgb(239 68 68)' : 'inherit',
      }}
    >
      {phase === 'success' ? '!' : phase === 'error' ? '!!' : phase === 'dismissing' ? '!' : 'Dunk'}
    </button>
  )
}

interface SpawnFormData {
  task: string
  model: string
  label: string
  timeoutSeconds: number
}

export function TaskBoardPanel() {
  const t = useTranslations('taskBoard')
  const statusColumns = STATUS_COLUMN_KEYS.map(col => ({ ...col, title: t(col.titleKey as any) }))
  const { tasks: storeTasks, setTasks: storeSetTasks, selectedTask, setSelectedTask, activeProject, availableModels, spawnRequests, addSpawnRequest, updateSpawnRequest, dashboardMode } = useMissionControl()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFilter, setProjectFilter] = useState<string>(
    activeProject ? String(activeProject.id) : 'all'
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aegisMap, setAegisMap] = useState<Record<number, boolean>>({})
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showSpawnForm, setShowSpawnForm] = useState(false)
  const [spawnFormData, setSpawnFormData] = useState<SpawnFormData>({
    task: '',
    model: 'sonnet',
    label: '',
    timeoutSeconds: 300
  })
  const [isSpawning, setIsSpawning] = useState(false)
  const [gnapStatus, setGnapStatus] = useState<{ enabled: boolean; taskCount?: number; lastSync?: string } | null>(null)
  const [gnapSyncing, setGnapSyncing] = useState(false)
  const isLocal = dashboardMode === 'local'
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

      // Render primary board data first; hydrate Aegis approvals in background.
      storeSetTasks(tasksList)
      setAgents(agentsData.agents || [])
      setProjects(projectsData.projects || [])

      if (taskIds.length > 0) {
        fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          .then((reviewResponse) => reviewResponse.ok ? reviewResponse.json() : null)
          .then((reviewData) => {
            const latest = reviewData?.latest || {}
            const newAegisMap: Record<number, boolean> = Object.fromEntries(
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved'
              ])
            )
            setAegisMap(newAegisMap)
          })
          .catch(() => {
            setAegisMap({})
          })
      } else {
        setAegisMap({})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [projectFilter, storeSetTasks])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Fetch GNAP status
  useEffect(() => {
    fetch('/api/gnap')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGnapStatus(data) })
      .catch(() => {})
  }, [])

  const handleGnapSync = useCallback(async () => {
    setGnapSyncing(true)
    try {
      const res = await fetch('/api/gnap?action=sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setGnapStatus(prev => prev ? { ...prev, taskCount: data.pushed, lastSync: data.lastSync } : prev)
      }
    } catch { /* ignore */ }
    finally { setGnapSyncing(false) }
  }, [])

  // Sync global activeProject into local projectFilter
  useEffect(() => {
    const newFilter = activeProject ? String(activeProject.id) : 'all'
    setProjectFilter(newFilter)
  }, [activeProject])

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

  // Group tasks by status, overriding for awaiting_owner detection
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => {
      const effectiveStatus = detectAwaitingOwner(task) ? 'awaiting_owner' : task.status
      return effectiveStatus === column.key
    })
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

  const handleSpawn = async () => {
    if (!spawnFormData.task.trim() || !spawnFormData.label.trim()) return

    setIsSpawning(true)
    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    addSpawnRequest({
      id: spawnId,
      task: spawnFormData.task,
      model: spawnFormData.model,
      label: spawnFormData.label,
      timeoutSeconds: spawnFormData.timeoutSeconds,
      status: 'pending',
      createdAt: Date.now()
    })

    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spawnFormData),
      })
      const result = await response.json()

      if (result.success) {
        updateSpawnRequest(spawnId, {
          status: 'running',
          result: result.sessionInfo || 'Agent spawned successfully'
        })
        setSpawnFormData({ task: '', model: 'sonnet', label: '', timeoutSeconds: 300 })
        setShowSpawnForm(false)
      } else {
        updateSpawnRequest(spawnId, {
          status: 'failed',
          error: result.error || 'Unknown error'
        })
      }
    } catch (error) {
      log.error('Spawn error:', error)
      updateSpawnRequest(spawnId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Network error'
      })
    } finally {
      setIsSpawning(false)
    }
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
      <div className="h-full flex flex-col" role="status" aria-live="polite">
        <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-7 w-28 bg-surface-1 rounded-md animate-pulse" />
            <div className="h-9 w-36 bg-surface-1 rounded-md animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-20 bg-surface-1 rounded-md animate-pulse" />
            <div className="h-9 w-24 bg-surface-1 rounded-md animate-pulse" />
          </div>
        </div>
        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, colIdx) => (
            <div key={colIdx} className="flex-1 min-w-80 bg-card border border-border rounded-lg flex flex-col">
              <div className="p-3 rounded-t-lg bg-surface-1 animate-pulse">
                <div className="h-5 w-24 bg-surface-2 rounded" />
              </div>
              <div className="flex-1 p-3 space-y-3">
                {Array.from({ length: 3 - colIdx }).map((_, cardIdx) => (
                  <div key={cardIdx} className="bg-surface-1 rounded-lg p-3 border-l-4 border-border space-y-2 animate-pulse">
                    <div className="h-4 w-3/4 bg-surface-2 rounded" />
                    <div className="h-3 w-full bg-surface-2/60 rounded" />
                    <div className="h-3 w-1/2 bg-surface-2/40 rounded" />
                    <div className="flex justify-between items-center pt-1">
                      <div className="h-3 w-20 bg-surface-2/50 rounded" />
                      <div className="h-3 w-16 bg-surface-2/50 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <span className="sr-only">{t('loadingTasks')}</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
          {gnapStatus?.enabled && (
            <button
              onClick={handleGnapSync}
              disabled={gnapSyncing}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              title={gnapStatus.lastSync ? `Last sync: ${gnapStatus.lastSync}` : 'Click to sync'}
            >
              GNAP
              {gnapStatus.taskCount != null && (
                <span className="text-emerald-400/70">{gnapStatus.taskCount}</span>
              )}
              {gnapSyncing && (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 1.5a6.5 6.5 0 1 1-4.5 2" />
                </svg>
              )}
            </button>
          )}
          <div className="relative">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-9 px-3 pr-8 bg-surface-1 text-foreground border border-border rounded-md text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">{t('allProjects')}</option>
              {projects.map((project) => (
                <option key={project.id} value={String(project.id)}>
                  {project.name} ({project.ticket_prefix})
                </option>
              ))}
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowProjectManager(true)}>
            {t('projects')}
          </Button>
          {!isLocal && (
            <Button variant="outline" onClick={() => setShowSpawnForm(!showSpawnForm)}>
              {showSpawnForm ? t('close') : t('spawnSubAgent')}
            </Button>
          )}
          <Button onClick={() => setShowCreateModal(true)}>
            {t('newTask')}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={fetchData} title={t('refresh')}>
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
              <path d="M13.5 2v3h-3M2.5 14v-3h3" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Spawn Form (collapsible) */}
      {showSpawnForm && (
        <div className="border-b border-border bg-surface-0 p-4">
          <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
            <div className="space-y-3">
              <textarea
                value={spawnFormData.task}
                onChange={(e) => setSpawnFormData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={t('spawnTaskPlaceholder')}
                className="w-full h-20 px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isSpawning}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={spawnFormData.label}
                  onChange={(e) => setSpawnFormData(prev => ({ ...prev, label: e.target.value }))}
                  placeholder={t('spawnLabelPlaceholder')}
                  className="flex-1 px-3 py-1.5 border border-border rounded-md bg-background text-foreground text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  disabled={isSpawning}
                />
                <select
                  value={spawnFormData.model}
                  onChange={(e) => setSpawnFormData(prev => ({ ...prev, model: e.target.value }))}
                  className="px-3 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  disabled={isSpawning}
                >
                  {availableModels.map((model) => (
                    <option key={model.alias} value={model.alias}>{model.alias}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="10"
                  max="3600"
                  value={spawnFormData.timeoutSeconds}
                  onChange={(e) => setSpawnFormData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) || 300 }))}
                  className="w-20 px-2 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  title={t('timeoutSeconds')}
                  disabled={isSpawning}
                />
                <Button
                  onClick={handleSpawn}
                  disabled={isSpawning || !spawnFormData.task.trim() || !spawnFormData.label.trim()}
                  size="sm"
                >
                  {isSpawning ? t('spawning') : t('spawn')}
                </Button>
              </div>
            </div>
            {/* Active spawn requests */}
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {spawnRequests.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">{t('noActiveSpawnRequests')}</div>
              ) : (
                spawnRequests.slice(0, 5).map((request) => (
                  <div key={request.id} className="flex items-center justify-between px-3 py-2 border border-border rounded-md text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{request.label}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                        request.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        request.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        request.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {request.status}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{request.model}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-2"
            aria-label={t('dismissError')}
          >
            ×
          </Button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 flex gap-4 p-4 overflow-x-auto" role="region" aria-label={t('taskBoard')}>
        {statusColumns.map(column => (
          <div
            key={column.key}
            role="region"
            aria-label={t('columnAriaLabel', { title: column.title, count: tasksByStatus[column.key]?.length || 0 })}
            className="flex-1 min-w-80 min-h-0 bg-surface-0 border border-border/60 rounded-xl flex flex-col transition-colors duration-200 [&.drag-over]:border-primary/40 [&.drag-over]:bg-primary/[0.02]"
            onDragEnter={(e) => handleDragEnter(e, column.key)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.key)}
          >
            {/* Column Header */}
            <div className={`${column.color} px-4 py-3 rounded-t-xl flex justify-between items-center border-b border-border/30`}>
              <h3 className="font-semibold text-sm tracking-wide">{column.title}</h3>
              <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded-md min-w-[1.75rem] text-center">
                {tasksByStatus[column.key]?.length || 0}
              </span>
            </div>

            {/* Column Body */}
            <div className="flex-1 p-2.5 space-y-2.5 min-h-32 h-full overflow-y-auto">
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
                  className={`group bg-card rounded-lg p-3 cursor-pointer border border-border/40 shadow-sm hover:shadow-md hover:shadow-black/10 hover:border-border/70 transition-all duration-200 ease-out border-l-4 ${priorityColors[task.priority]} ${
                    draggedTask?.id === task.id ? 'opacity-40 scale-[0.97] rotate-1' : ''
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
                >
                  {/* Drag handle + Title row */}
                  <div className="flex items-start gap-2 mb-2">
                    {/* Grip handle — visible on hover */}
                    <svg className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors shrink-0 cursor-grab" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
                      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
                      <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="text-foreground font-medium text-sm leading-tight line-clamp-2">
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {task.metadata?.recurrence?.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono" title={task.metadata.recurrence.natural_text || task.metadata.recurrence.cron_expr}>
                              {t('recurring')}
                            </span>
                          )}
                          {task.metadata?.recurrence?.parent_task_id && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400/70 font-mono" title={t('spawnedFromTask', { id: task.metadata.recurrence.parent_task_id })}>
                              {t('spawned')}
                            </span>
                          )}
                          {task.ticket_ref && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono">
                              {task.ticket_ref}
                            </span>
                          )}
                          {task.github_issue_number && task.github_repo && (
                            <a
                              href={`https://github.com/${task.github_repo}/issues/${task.github_issue_number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#24292e]/30 text-gray-300 hover:text-white font-mono flex items-center gap-1 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                              title={`GitHub issue #${task.github_issue_number}`}
                            >
                              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                              #{task.github_issue_number}
                            </a>
                          )}
                          {task.github_pr_number && task.github_repo && (
                            <a
                              href={`https://github.com/${task.github_repo}/pull/${task.github_pr_number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1 transition-colors ${
                                task.github_pr_state === 'merged' ? 'bg-purple-500/20 text-purple-400' :
                                task.github_pr_state === 'closed' ? 'bg-red-500/20 text-red-400' :
                                'bg-green-500/20 text-green-400'
                              }`}
                              onClick={(e) => e.stopPropagation()}
                              title={`PR #${task.github_pr_number} (${task.github_pr_state || 'open'})`}
                            >
                              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>
                              PR #{task.github_pr_number}
                            </a>
                          )}
                          {task.aegisApproved && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              Aegis
                            </span>
                          )}
                          {detectAwaitingOwner(task) && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 font-mono">
                              {t('colAwaitingOwner')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {task.description && (
                    <div className="mb-2 ml-5.5 line-clamp-2 overflow-hidden text-xs text-muted-foreground">
                      <MarkdownRenderer content={task.description} preview />
                    </div>
                  )}

                  {/* Footer: assignee, priority, timestamp */}
                  <div className="flex items-center justify-between gap-2 ml-5.5 mt-auto pt-2 border-t border-border/20">
                    <span className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
                      {task.assigned_to ? (
                        <>
                          <AgentAvatar name={getAgentName(task.assigned_to)} size="xs" />
                          <span className="truncate max-w-[8rem]">{getAgentName(task.assigned_to)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50 italic">{t('unassigned')}</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.comment_count != null && task.comment_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70" title={`${task.comment_count} comment${task.comment_count !== 1 ? 's' : ''}`}>
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z" />
                          </svg>
                          {task.comment_count}
                        </span>
                      )}
                      {task.status !== 'done' && (
                        <DunkItButton taskId={task.id} onDunked={() => fetchData()} />
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        task.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                        task.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                        task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>
                        {t(`priority_${task.priority}` as any)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">{formatTaskTimestamp(task.created_at)}</span>
                    </div>
                  </div>

                  {/* Tags row */}
                  {task.tags && task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 ml-5.5">
                      {task.tags.slice(0, 3).map((tag, index) => (
                        <span
                          key={index}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="text-muted-foreground/60 text-[10px]">+{task.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Due date — prominent when overdue */}
                  {task.due_date && (
                    <div className="mt-1.5 ml-5.5 text-[10px]">
                      <span className={`inline-flex items-center gap-1 ${
                        task.due_date * 1000 < Date.now() ? 'text-red-400 font-medium' : 'text-muted-foreground/60'
                      }`}>
                        {task.due_date * 1000 < Date.now() ? '! ' : ''}{t('due')} {formatTaskTimestamp(task.due_date)}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Empty State */}
              {tasksByStatus[column.key]?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/30">
                  <svg className="w-8 h-8 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 12h6M12 9v6" strokeLinecap="round" />
                  </svg>
                  <span className="text-xs">{t('dropTasksHere')}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Claude Code Tasks */}
      <ClaudeCodeTasksSection />

      {/* Hermes Scheduled Tasks */}
      <HermesCronSection />

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
          onDelete={fetchData}
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
  onEdit,
  onDelete
}: {
  task: Task
  agents: Agent[]
  projects: Project[]
  onClose: () => void
  onUpdate: () => void
  onEdit: (task: Task) => void
  onDelete: () => void
}) {
  const t = useTranslations('taskBoard')
  const router = useRouter()
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
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality' | 'session'>('details')
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
      onUpdate() // refreshes task data (picks up auto-assignment from @mention)
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
      setBroadcastStatus(t('broadcastSent', { count: data.sent || 0 }))
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

  const parseCommentContent = (raw: string): { text: string; meta?: { model?: string; provider?: string; durationMs?: number; tokens?: number } } => {
    // Strip ANSI escape codes
    const stripped = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[3[0-9]m/g, '').replace(/\[39m/g, '')

    // Try to parse as JSON payload (OpenClaw agent result format)
    try {
      const parsed = JSON.parse(stripped)
      if (parsed && typeof parsed === 'object') {
        let text = ''
        let meta: { model?: string; provider?: string; durationMs?: number; tokens?: number } | undefined

        // Extract text from payloads array
        if (Array.isArray(parsed.payloads)) {
          text = parsed.payloads
            .map((p: any) => (typeof p === 'string' ? p : p?.text || '').trim())
            .filter(Boolean)
            .join('\n')
        }

        // Extract compact meta
        if (parsed.meta?.agentMeta) {
          const am = parsed.meta.agentMeta
          meta = {
            model: am.model,
            provider: am.provider,
            durationMs: parsed.meta.durationMs,
            tokens: am.usage?.total,
          }
        }

        if (text) return { text, meta }
      }
    } catch {
      // Not JSON — treat as plain text
    }

    // Clean up any remaining ANSI prefixes from log lines
    const cleaned = stripped
      .split('\n')
      .map(line => line.replace(/^\[[\w/-]+\]\s*/, '').trim())
      .filter(line => line && !line.startsWith('{') && !line.startsWith('"'))
      .join('\n')

    return { text: cleaned || stripped }
  }

  const renderComment = (comment: Comment, depth: number = 0) => {
    const { text, meta } = parseCommentContent(comment.content)
    return (
      <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground/80">{comment.author}</span>
            {meta && (
              <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground">
                {meta.model}{meta.tokens ? ` · ${meta.tokens.toLocaleString()} tok` : ''}{meta.durationMs ? ` · ${(meta.durationMs / 1000).toFixed(1)}s` : ''}
              </span>
            )}
          </div>
          <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
        </div>
        <div className="text-sm text-foreground/90 mt-1 prose prose-invert prose-sm max-w-none"><MarkdownRenderer content={text} /></div>
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-3 space-y-3">
            {comment.replies.map(reply => renderComment(reply, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const dialogRef = useFocusTrap(onClose)

  const statusColors: Record<string, string> = {
    inbox: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
    assigned: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    in_progress: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    review: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    quality_review: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    done: 'bg-green-500/15 text-green-400 border-green-500/25',
    awaiting_owner: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  }

  const priorityBadgeColors: Record<string, string> = {
    critical: 'bg-red-500/15 text-red-400 border-red-500/25',
    urgent: 'bg-red-500/15 text-red-400 border-red-500/25',
    high: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
    medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    low: 'bg-green-500/15 text-green-400 border-green-500/25',
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl shadow-black/30">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border/50">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {task.ticket_ref && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono shrink-0">{task.ticket_ref}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColors[task.status] || statusColors.inbox}`}>
                  {task.status.replace(/_/g, ' ')}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityBadgeColors[task.priority] || priorityBadgeColors.medium}`}>
                  {t(`priority_${task.priority}` as any)}
                </span>
              </div>
              <h3 id="task-detail-title" className="text-lg font-semibold text-foreground leading-tight">{task.title}</h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon-sm" onClick={() => onEdit(task)} className="text-muted-foreground hover:text-foreground" aria-label={t('edit')}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11.5 1.5l3 3-9 9H2.5v-3z" /><path d="M9.5 3.5l3 3" /></svg>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-red-400"
                aria-label={t('delete')}
                onClick={async () => {
                  if (!confirm(t('deleteTaskConfirm', { title: task.title }))) return
                  try {
                    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
                    if (!res.ok) {
                      const errorData = await res.json().catch(() => ({ error: 'Failed to delete task' }))
                      throw new Error(errorData.error || 'Failed to delete task')
                    }
                    onClose()
                  } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Failed to delete task'
                    alert(errorMessage)
                  }
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6.5 7v4M9.5 7v4M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9" /></svg>
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('closeTaskDetails')} className="text-muted-foreground hover:text-foreground">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </Button>
            </div>
          </div>
          {task.description ? (
            <div className="mt-3 text-sm text-foreground/80">
              <MarkdownRenderer content={task.description} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground/50 italic">{t('noDescription')}</p>
          )}
        </div>

        {/* Failed task: error message + retry button */}
        {task.status === 'failed' && (
          <div className="mx-6 mb-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 space-y-2">
            {task.error_message && (
              <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">{task.error_message}</p>
            )}
            {task.dispatch_attempts != null && task.dispatch_attempts > 0 && (
              <p className="text-2xs text-muted-foreground">Dispatch attempts: {task.dispatch_attempts}</p>
            )}
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/tasks/${task.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'assigned', dispatch_attempts: 0, error_message: null }),
                  })
                  if (res.ok) onClose()
                } catch { /* ignore */ }
              }}
              className="text-xs px-3 py-1.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 transition-colors"
            >
              {t('retryTask')}
            </button>
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-4">
          <div className="flex gap-1.5 mb-4" role="tablist" aria-label={t('taskDetailTabs')}>
            {(['details', 'comments', 'quality'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`tabpanel-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {tab === 'details' ? t('tabDetails') : tab === 'comments' ? t('tabComments') : t('tabQualityReview')}
                {tab === 'comments' && comments.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">{comments.length}</span>
                )}
              </button>
            ))}
            {task.metadata?.dispatch_session_id && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'session'}
                aria-controls="tabpanel-session"
                onClick={() => setActiveTab('session')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center ${
                  activeTab === 'session'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {t('tabSession')}
                {task.status === 'in_progress' && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                )}
              </button>
            )}
          </div>

          {activeTab === 'details' && (
            <div id="tabpanel-details" role="tabpanel" aria-label={t('tabDetails')} className="space-y-4">
              {/* Assignment row */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/30">
                <span className="text-xs text-muted-foreground shrink-0">{t('assignedTo')}</span>
                <select
                  className="flex-1 text-xs bg-card border border-border rounded-md px-2 py-1.5 text-foreground cursor-pointer focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition-colors"
                  value={task.assigned_to || ''}
                  onChange={async (e) => {
                    const newAssignee = e.target.value || null
                    try {
                      const res = await fetch(`/api/tasks/${task.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ assigned_to: newAssignee }),
                      })
                      if (!res.ok) throw new Error('Failed to assign')
                      onUpdate()
                    } catch {
                      // silently fail — onUpdate will refresh state
                    }
                  }}
                >
                  <option value="">{t('unassigned')}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.name}>{agent.name}</option>
                  ))}
                </select>
                {task.assigned_to && <AgentAvatar name={task.assigned_to} size="xs" />}
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {resolvedProjectName && (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground/60 uppercase tracking-wider text-[10px]">{t('project')}</span>
                    <div className="text-foreground font-medium">{resolvedProjectName}</div>
                  </div>
                )}
                <div className="space-y-0.5">
                  <span className="text-muted-foreground/60 uppercase tracking-wider text-[10px]">{t('created')}</span>
                  <div className="text-foreground">{new Date(task.created_at * 1000).toLocaleDateString()}</div>
                </div>
                {task.due_date && (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground/60 uppercase tracking-wider text-[10px]">Due</span>
                    <div className="text-foreground">{new Date(task.due_date * 1000).toLocaleDateString()}</div>
                  </div>
                )}
              </div>

              {/* GitHub section */}
              {(task.github_issue_number || task.github_branch || task.github_pr_number) && (
                <div className="pt-3 border-t border-border/30 space-y-2">
                  <span className="text-muted-foreground/60 uppercase tracking-wider text-[10px]">GitHub</span>
                  <div className="flex flex-wrap gap-2">
                    {task.github_issue_number && task.github_repo && (
                      <a
                        href={`https://github.com/${task.github_repo}/issues/${task.github_issue_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary/50 border border-border/30 text-foreground/80 hover:text-primary hover:border-primary/30 transition-colors font-mono"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        #{task.github_issue_number}
                      </a>
                    )}
                    {task.github_pr_number && task.github_repo && (
                      <a
                        href={`https://github.com/${task.github_repo}/pull/${task.github_pr_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border font-mono transition-colors ${
                          task.github_pr_state === 'merged' ? 'bg-purple-500/10 border-purple-500/25 text-purple-400' :
                          task.github_pr_state === 'closed' ? 'bg-red-500/10 border-red-500/25 text-red-400' :
                          'bg-green-500/10 border-green-500/25 text-green-400'
                        }`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>
                        PR #{task.github_pr_number}
                      </a>
                    )}
                    {task.github_branch && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary/50 border border-border/30 text-foreground/60 font-mono">
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/></svg>
                        {task.github_branch}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Agent session */}
              {task.metadata?.dispatch_session_id && (
                <div className="pt-3 border-t border-border/30">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveTab('session')}
                    className="font-mono text-xs"
                  >
                    View Session {task.metadata.dispatch_session_id.slice(0, 8)}...
                    {task.status === 'in_progress' && (
                      <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'comments' && (
            <div id="tabpanel-comments" role="tabpanel" aria-label={t('tabComments')} className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-foreground">{t('tabComments')}</h4>
              <Button variant="link" size="xs" onClick={fetchComments} className="text-blue-400 hover:text-blue-300">
                {t('refresh')}
              </Button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-sm mb-3">
                {commentError}
              </div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-sm">{t('loadingComments')}</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/50 text-sm">{t('noComments')}</div>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('postingAs')}</span>
                <span className="font-medium text-foreground">{commentAuthor}</span>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('newComment')}</label>
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
                <Button type="submit">
                  {t('addComment')}
                </Button>
              </div>
            </form>

            <div className="mt-5 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-blue-300">How notifications work</div>
              <div><strong className="text-foreground">Comments</strong> are persisted on the task and notify all subscribers. Subscribers are auto-added when they: create the task, are assigned to it, comment on it, or are @mentioned.</div>
              <div><strong className="text-foreground">Broadcasts</strong> send a one-time notification to all current subscribers without creating a comment record.</div>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <h5 className="text-sm font-medium text-foreground mb-2">{t('broadcastToSubscribers')}</h5>
              {broadcastStatus && (
                <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <MentionTextarea
                  value={broadcastMessage}
                  onChange={setBroadcastMessage}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={2}
                  placeholder={t('broadcastPlaceholder')}
                  mentionTargets={mentionTargets}
                />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" className="bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30">
                    {t('broadcast')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
          )}

          {activeTab === 'quality' && (
            <div id="tabpanel-quality" role="tabpanel" aria-label={t('tabQualityReview')} className="mt-6">
              <h5 className="text-sm font-medium text-foreground mb-2">{t('aegisQualityReview')}</h5>
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
                <div className="text-xs text-muted-foreground mb-3">{t('noReviews')}</div>
              )}
              <form onSubmit={handleSubmitReview} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder={t('reviewerPlaceholder')}
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
                    placeholder={t('reviewNotesPlaceholder')}
                  />
                  <Button type="submit" variant="success" size="xs">
                    {t('submit')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'session' && task.metadata?.dispatch_session_id && (
            <div id="tabpanel-session" role="tabpanel" aria-label="Session" className="mt-4">
              <TaskSessionFeed
                sessionId={task.metadata.dispatch_session_id}
                agentName={task.assigned_to}
                isLive={task.status === 'in_progress'}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskSessionFeed({ sessionId, agentName, isLive }: { sessionId: string; agentName?: string; isLive: boolean }) {
  const t = useTranslations('taskBoard')
  const [messages, setMessages] = useState<SessionTranscriptMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const fetchTranscript = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/transcript?kind=claude-code&id=${encodeURIComponent(sessionId)}&limit=100`)
      if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`)
      const data = await res.json()
      setMessages(data.messages || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load session transcript')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Initial fetch
  useEffect(() => { fetchTranscript() }, [fetchTranscript])

  // Auto-refresh when live
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(fetchTranscript, 5000)
    return () => clearInterval(interval)
  }, [isLive, fetchTranscript])

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevCountRef.current = messages.length
  }, [messages.length])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {agentName && (
            <span className="flex items-center gap-1.5">
              <AgentAvatar name={agentName} size="xs" />
              <span className="font-medium text-foreground">{agentName}</span>
            </span>
          )}
          <span className="font-mono text-muted-foreground/50">{sessionId.slice(0, 12)}...</span>
          {isLive && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              {t('live')}
            </span>
          )}
        </div>
        <Button variant="link" size="xs" onClick={fetchTranscript} className="text-blue-400 hover:text-blue-300">
          {t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm py-4 text-center">{t('loadingTranscript')}</div>
      ) : messages.length === 0 ? (
        <div className="text-muted-foreground/50 text-sm py-4 text-center">{t('noSessionMessages')}</div>
      ) : (
        <div ref={scrollRef} className="max-h-[50vh] overflow-y-auto space-y-0.5 rounded border border-border/30 bg-black/10 p-2">
          {messages.map((msg, idx) => (
            <SessionMessage
              key={idx}
              message={msg}
              showTimestamp={shouldShowTimestamp(msg, messages[idx - 1])}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Claude Code Tasks Section — read-only bridge
function ClaudeCodeTasksSection() {
  const t = useTranslations('taskBoard')
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ teams: any[]; tasks: any[] }>({ teams: [], tasks: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/claude-tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  const tasksByTeam = data.tasks.reduce<Record<string, any[]>>((acc, t) => {
    (acc[t.teamName] ||= []).push(t)
    return acc
  }, {})

  const statusColor = (s: string) =>
    s === 'completed' ? 'text-green-400' :
    s === 'in_progress' ? 'text-blue-400' :
    s === 'blocked' ? 'text-red-400' :
    s === 'awaiting_owner' ? 'text-orange-400' :
    'text-muted-foreground'

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{t('claudeCodeTasks')}</span>
          {data.tasks.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">{data.tasks.length}</span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">{expanded ? t('collapse') : t('expand')}</span>
      </button>
      {expanded && (
        <div className="p-4 border-t border-border space-y-4">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">{t('loading')}</div>
          ) : data.tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              <p className="font-medium">{t('noTeamTasksFound')}</p>
              <p className="text-xs mt-1 text-muted-foreground/70">{t('noTeamTasksDesc')}</p>
            </div>
          ) : (
            Object.entries(tasksByTeam).map(([team, tasks]) => (
              <div key={team}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-foreground">{team}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{t('taskCount', { count: tasks.length })}</span>
                  {data.teams.find(t => t.name === team)?.members?.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {data.teams.find(t => t.name === team).members.map((m: any) => m.name).join(', ')}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {tasks.map((task: any) => (
                    <div key={task.id} className={`flex items-center gap-3 px-3 py-2 rounded bg-surface-1 border border-border text-sm ${task.stale ? 'opacity-50' : ''}`}>
                      <span className={`text-[10px] font-mono ${task.stale ? 'text-muted-foreground/50' : statusColor(task.status)}`}>
                        {task.stale ? 'stale' : task.status}
                      </span>
                      <span className={`flex-1 truncate ${task.stale ? 'text-muted-foreground' : 'text-foreground'}`}>{task.subject}</span>
                      {task.owner && <span className="text-[10px] text-muted-foreground">{task.owner}</span>}
                      {task.blockedBy?.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{t('blocked')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function HermesCronSection() {
  const t = useTranslations('taskBoard')
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ cronJobs: any[] }>({ cronJobs: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/hermes/tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{t('hermesScheduledTasks')}</span>
          {data.cronJobs.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{data.cronJobs.length}</span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">{expanded ? t('collapse') : t('expand')}</span>
      </button>
      {expanded && (
        <div className="p-4 border-t border-border space-y-2">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">{t('loading')}</div>
          ) : data.cronJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              <p className="font-medium">{t('noScheduledTasksFound')}</p>
              <p className="text-xs mt-1 text-muted-foreground/70">{t('noScheduledTasksDesc')}</p>
            </div>
          ) : (
            data.cronJobs.map((job: any) => (
              <div key={job.id} className="flex items-center gap-3 px-3 py-2 rounded bg-surface-1 border border-border text-sm">
                <span className={`text-[10px] font-mono shrink-0 ${job.enabled ? 'text-purple-400' : 'text-muted-foreground/50'}`}>
                  {job.schedule || t('noSchedule')}
                </span>
                <span className="text-foreground flex-1 truncate">{job.prompt || job.id}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${job.enabled ? 'bg-green-500/15 text-green-400' : 'bg-muted text-muted-foreground'}`}>
                  {job.enabled ? t('enabled') : t('disabled')}
                </span>
                {job.lastRunAt && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">{job.lastRunAt}</span>
                )}
              </div>
            ))
          )}
        </div>
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
    project_id: projects[0]?.id ? String(projects[0].id) : '',
    assigned_to: '',
    tags: '',
    target_session: '',
  })
  const t = useTranslations('taskBoard')
  const agentSessions = useAgentSessions(formData.assigned_to || undefined)
  const [isRecurring, setIsRecurring] = useState(false)
  const [scheduleInput, setScheduleInput] = useState('')
  const [parsedSchedule, setParsedSchedule] = useState<{ cronExpr: string; humanReadable: string } | null>(null)
  const [scheduleError, setScheduleError] = useState('')
  const mentionTargets = useMentionTargets()

  const handleScheduleChange = async (value: string) => {
    setScheduleInput(value)
    setScheduleError('')
    setParsedSchedule(null)
    if (!value.trim()) return
    try {
      const res = await fetch(`/api/schedule-parse?input=${encodeURIComponent(value.trim())}`)
      const data = await res.json()
      if (data.cronExpr) {
        setParsedSchedule(data)
      } else {
        setScheduleError('Could not parse schedule')
      }
    } catch {
      setScheduleError('Parse failed')
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
    if (formData.target_session) {
      metadata.target_session = formData.target_session
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
          <h3 id="create-task-title" className="text-xl font-bold text-foreground mb-4">{t('createNewTask')}</h3>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="create-title" className="block text-sm text-muted-foreground mb-1">{t('fieldTitle')}</label>
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
              <label htmlFor="create-description" className="block text-sm text-muted-foreground mb-1">{t('fieldDescription')}</label>
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
                <label htmlFor="create-priority" className="block text-sm text-muted-foreground mb-1">{t('fieldPriority')}</label>
                <select
                  id="create-priority"
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="low">{t('priority_low')}</option>
                  <option value="medium">{t('priority_medium')}</option>
                  <option value="high">{t('priority_high')}</option>
                  <option value="critical">{t('priority_critical')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="create-project" className="block text-sm text-muted-foreground mb-1">{t('fieldProject')}</label>
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
              <label htmlFor="create-assignee" className="block text-sm text-muted-foreground mb-1">{t('fieldAssignTo')}</label>
              <select
                id="create-assignee"
                value={formData.assigned_to}
                onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value, target_session: '' }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">{t('unassigned')}</option>
                {agents.map(agent => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name} ({agent.role})
                  </option>
                ))}
              </select>
            </div>

            {formData.assigned_to && agentSessions.length > 0 && (
              <div>
                <label htmlFor="create-target-session" className="block text-sm text-muted-foreground mb-1">Target Session</label>
                <select
                  id="create-target-session"
                  value={formData.target_session}
                  onChange={(e) => setFormData(prev => ({ ...prev, target_session: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">New session (default)</option>
                  {agentSessions.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.displayLabel}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Send task to an existing agent session instead of creating a new one.</p>
              </div>
            )}

            <div>
              <label htmlFor="create-tags" className="block text-sm text-muted-foreground mb-1">{t('fieldTags')}</label>
              <input
                id="create-tags"
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="frontend, urgent, bug"
              />
            </div>

            {/* Recurring Schedule */}
            <div className="border border-border rounded-md p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => {
                    setIsRecurring(e.target.checked)
                    if (!e.target.checked) {
                      setParsedSchedule(null)
                      setScheduleInput('')
                      setScheduleError('')
                    }
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm text-foreground">{t('makeRecurring')}</span>
              </label>
              {isRecurring && (
                <div>
                  <input
                    type="text"
                    value={scheduleInput}
                    onChange={(e) => handleScheduleChange(e.target.value)}
                    className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder='e.g. "every morning at 9am" or "every 2 hours"'
                  />
                  {parsedSchedule && (
                    <p className="text-xs text-cyan-400 mt-1">
                      {parsedSchedule.humanReadable} <span className="text-muted-foreground font-mono">({parsedSchedule.cronExpr})</span>
                    </p>
                  )}
                  {scheduleError && (
                    <p className="text-xs text-red-400 mt-1">{scheduleError}. Try: &quot;daily at 9am&quot;, &quot;every 2 hours&quot;, &quot;weekly on monday&quot;</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit" className="flex-1" disabled={isRecurring && !parsedSchedule}>
              {isRecurring ? t('createRecurringTask') : t('createTask')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {t('cancel')}
            </Button>
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
  const t = useTranslations('taskBoard')
  const [formData, setFormData] = useState({
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    status: task.status,
    project_id: task.project_id ? String(task.project_id) : (projects[0]?.id ? String(projects[0].id) : ''),
    assigned_to: task.assigned_to || '',
    tags: task.tags ? task.tags.join(', ') : '',
    target_session: task.metadata?.target_session || '',
  })
  const mentionTargets = useMentionTargets()
  const agentSessions = useAgentSessions(formData.assigned_to || undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) return

    try {
      const existingMeta = task.metadata || {}
      const updatedMeta = { ...existingMeta }
      if (formData.target_session) {
        updatedMeta.target_session = formData.target_session
      } else {
        delete updatedMeta.target_session
      }

      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          project_id: formData.project_id ? Number(formData.project_id) : undefined,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined,
          metadata: updatedMeta,
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
          <h3 id="edit-task-title" className="text-xl font-bold text-foreground mb-4">{t('editTask')}</h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="edit-title" className="block text-sm text-muted-foreground mb-1">{t('fieldTitle')}</label>
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
              <label htmlFor="edit-description" className="block text-sm text-muted-foreground mb-1">{t('fieldDescription')}</label>
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
                <label htmlFor="edit-status" className="block text-sm text-muted-foreground mb-1">{t('fieldStatus')}</label>
                <select
                  id="edit-status"
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as Task['status'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="inbox">{t('colInbox')}</option>
                  <option value="assigned">{t('colAssigned')}</option>
                  <option value="in_progress">{t('colInProgress')}</option>
                  <option value="review">{t('colReview')}</option>
                  <option value="quality_review">{t('colQualityReview')}</option>
                  <option value="done">{t('colDone')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="edit-priority" className="block text-sm text-muted-foreground mb-1">{t('fieldPriority')}</label>
                <select
                  id="edit-priority"
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="low">{t('priority_low')}</option>
                  <option value="medium">{t('priority_medium')}</option>
                  <option value="high">{t('priority_high')}</option>
                  <option value="critical">{t('priority_critical')}</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="edit-project" className="block text-sm text-muted-foreground mb-1">{t('fieldProject')}</label>
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
              <label htmlFor="edit-assignee" className="block text-sm text-muted-foreground mb-1">{t('fieldAssignTo')}</label>
              <select
                id="edit-assignee"
                value={formData.assigned_to}
                onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value, target_session: '' }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">{t('unassigned')}</option>
                {agents.map(agent => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name} ({agent.role})
                  </option>
                ))}
              </select>
            </div>

            {formData.assigned_to && agentSessions.length > 0 && (
              <div>
                <label htmlFor="edit-target-session" className="block text-sm text-muted-foreground mb-1">Target Session</label>
                <select
                  id="edit-target-session"
                  value={formData.target_session}
                  onChange={(e) => setFormData(prev => ({ ...prev, target_session: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">New session (default)</option>
                  {agentSessions.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.displayLabel}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Send task to an existing agent session instead of creating a new one.</p>
              </div>
            )}

            <div>
              <label htmlFor="edit-tags" className="block text-sm text-muted-foreground mb-1">{t('fieldTags')}</label>
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
            <Button type="submit" className="flex-1">
              {t('saveChanges')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {t('cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
