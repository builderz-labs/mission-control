'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import { Button } from '@/components/ui/button'
import { ProjectManagerModal } from '@/components/modals/project-manager-modal'
import { useTaskBoardData } from './task-board/use-task-board-data'

import {
  statusColumns,
  TaskColumn,
  TaskDetailModal,
  CreateTaskModal,
  EditTaskModal,
  ClaudeCodeTasksSection,
  HermesCronSection,
  SpawnForm,
  TaskBoardSkeleton,
} from './task-board'
import type { Task, Agent, Project, SpawnFormData } from './task-board'

const log = createClientLogger('TaskBoardPanel')

// ─── Main component ──────────────────────────────────────────────────────────

export function TaskBoardPanel() {
  const {
    tasks: storeTasks,
    selectedTask,
    setSelectedTask,
    activeProject,
    availableModels,
    spawnRequests,
    addSpawnRequest,
    updateSpawnRequest,
    dashboardMode,
    updateTask,
  } = useMissionControl()

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [projectFilter, setProjectFilter] = useState<string>(
    activeProject ? String(activeProject.id) : 'all'
  )
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showSpawnForm, setShowSpawnForm] = useState(false)
  const [spawnFormData, setSpawnFormData] = useState<SpawnFormData>({
    task: '',
    model: 'sonnet',
    label: '',
    timeoutSeconds: 300,
  })
  const [isSpawning, setIsSpawning] = useState(false)

  const isLocal = dashboardMode === 'local'
  const dragCounter = useRef(0)
  const selectedTaskIdFromUrl = Number.parseInt(searchParams.get('taskId') || '', 10)

  const { agents, projects, aegisMap, loading, error, fetchData, clearError } =
    useTaskBoardData(projectFilter)

  // Augment store tasks with computed aegisApproved flag
  const tasks: Task[] = storeTasks.map((t) => ({ ...t, aegisApproved: Boolean(aegisMap[t.id]) }))

  const updateTaskUrl = useCallback(
    (taskId: number | null, mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams(searchParams.toString())
      if (typeof taskId === 'number' && Number.isFinite(taskId)) {
        params.set('taskId', String(taskId))
      } else {
        params.delete('taskId')
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      if (mode === 'replace') { router.replace(href); return }
      router.push(href)
    },
    [pathname, router, searchParams]
  )

  // Sync global activeProject into local projectFilter
  useEffect(() => {
    setProjectFilter(activeProject ? String(activeProject.id) : 'all')
  }, [activeProject])

  // Sync URL task param → selectedTask
  useEffect(() => {
    if (!Number.isFinite(selectedTaskIdFromUrl)) {
      if (selectedTask) setSelectedTask(null)
      return
    }
    const match = tasks.find((t) => t.id === selectedTaskIdFromUrl)
    if (match) {
      if (selectedTask?.id !== match.id) setSelectedTask(match)
      return
    }
    if (!loading) {
      setSelectedTask(null)
    }
  }, [loading, selectedTask, selectedTaskIdFromUrl, setSelectedTask, tasks])

  useEffect(() => { fetchData() }, [fetchData])

  // Poll as SSE fallback — pauses when SSE delivers events
  useSmartPoll(fetchData, 30000, { pauseWhenSseConnected: true })

  // Group tasks by kanban column
  const tasksByStatus = statusColumns.reduce((acc, col) => {
    return { ...acc, [col.key]: tasks.filter((t) => t.status === col.key) }
  }, {} as Record<string, Task[]>)

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML)
  }

  const handleDragEnter = (e: React.DragEvent, _status: string) => {
    e.preventDefault()
    dragCounter.current++
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    dragCounter.current--
    if (dragCounter.current === 0) e.currentTarget.classList.remove('drag-over')
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    dragCounter.current = 0
    e.currentTarget.classList.remove('drag-over')
    if (!draggedTask || draggedTask.status === newStatus) { setDraggedTask(null); return }
    await dropTask(draggedTask, newStatus)
    setDraggedTask(null)
  }

  const dropTask = async (task: Task, newStatus: string) => {
    const previousStatus = task.status
    try {
      if (newStatus === 'done') {
        const reviewRes = await fetch(`/api/quality-review?taskId=${task.id}`, { signal: AbortSignal.timeout(8000) })
        if (!reviewRes.ok) throw new Error('Unable to verify Aegis approval')
        const reviewData = await reviewRes.json()
        const latest = reviewData.reviews?.find((r: { reviewer: string }) => r.reviewer === 'aegis')
        if (!latest || latest.status !== 'approved') throw new Error('Aegis approval is required before moving to done')
      }

      // Optimistic update via Zustand
      updateTask(task.id, { status: newStatus as Task['status'], updated_at: Math.floor(Date.now() / 1000) })

      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [{ id: task.id, status: newStatus }] }),
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update task status')
      }
    } catch (err) {
      // Revert optimistic update
      updateTask(task.id, { status: previousStatus })
      // Surface error to user via the board's error banner
      throw err
    }
  }

  // ── Spawn sub-agent ─────────────────────────────────────────────────────────

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
      createdAt: Date.now(),
    })

    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spawnFormData),
        signal: AbortSignal.timeout(8000),
      })
      const result = await response.json()

      if (result.success) {
        updateSpawnRequest(spawnId, { status: 'running', result: result.sessionInfo || 'Agent spawned successfully' })
        setSpawnFormData({ task: '', model: 'sonnet', label: '', timeoutSeconds: 300 })
        setShowSpawnForm(false)
      } else {
        updateSpawnRequest(spawnId, { status: 'failed', error: result.error || 'Unknown error' })
      }
    } catch (spawnErr) {
      log.error('Spawn error:', spawnErr)
      updateSpawnRequest(spawnId, {
        status: 'failed',
        error: spawnErr instanceof Error ? getErrorMessage(spawnErr) : 'Network error',
      })
    } finally {
      setIsSpawning(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return <TaskBoardSkeleton />

  return (
    <div className="h-full flex flex-col">
      <BoardHeader
        projects={projects}
        projectFilter={projectFilter}
        isLocal={isLocal}
        showSpawnForm={showSpawnForm}
        onProjectFilterChange={setProjectFilter}
        onProjectManagerOpen={() => setShowProjectManager(true)}
        onToggleSpawnForm={() => setShowSpawnForm(!showSpawnForm)}
        onCreateTask={() => setShowCreateModal(true)}
        onRefresh={fetchData}
      />

      {showSpawnForm && (
        <SpawnForm
          formData={spawnFormData}
          onFormChange={setSpawnFormData}
          onSpawn={handleSpawn}
          isSpawning={isSpawning}
          availableModels={availableModels}
          spawnRequests={spawnRequests}
        />
      )}

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="icon-xs" onClick={clearError} className="text-red-400/60 hover:text-red-400 ml-2" aria-label="Dismiss error">×</Button>
        </div>
      )}

      <div className="flex-1 flex gap-4 p-4 overflow-x-auto" role="region" aria-label="Task board">
        {statusColumns.map((column) => (
          <TaskColumn
            key={column.key}
            column={column}
            tasks={tasksByStatus[column.key] || []}
            agents={agents}
            draggedTaskId={draggedTask?.id ?? null}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onTaskClick={(task) => { setSelectedTask(task); updateTaskUrl(task.id) }}
          />
        ))}
      </div>

      <ClaudeCodeTasksSection />
      <HermesCronSection />

      {selectedTask && !editingTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          projects={projects}
          onClose={() => { setSelectedTask(null); updateTaskUrl(null) }}
          onUpdate={fetchData}
          onEdit={(taskToEdit) => { setEditingTask(taskToEdit); setSelectedTask(null); updateTaskUrl(null, 'replace') }}
          onDelete={fetchData}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal agents={agents} projects={projects} onClose={() => setShowCreateModal(false)} onCreated={fetchData} />
      )}

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
        <ProjectManagerModal onClose={() => setShowProjectManager(false)} onChanged={fetchData} />
      )}
    </div>
  )
}

// ─── Board header ─────────────────────────────────────────────────────────────

function BoardHeader({
  projects,
  projectFilter,
  isLocal,
  showSpawnForm,
  onProjectFilterChange,
  onProjectManagerOpen,
  onToggleSpawnForm,
  onCreateTask,
  onRefresh,
}: {
  projects: Project[]
  projectFilter: string
  isLocal: boolean
  showSpawnForm: boolean
  onProjectFilterChange: (v: string) => void
  onProjectManagerOpen: () => void
  onToggleSpawnForm: () => void
  onCreateTask: () => void
  onRefresh: () => void
}) {
  return (
    <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-foreground">Task Board</h2>
        <div className="relative">
          <select
            value={projectFilter}
            onChange={(e) => onProjectFilterChange(e.target.value)}
            className="h-9 px-3 pr-8 bg-surface-1 text-foreground border border-border rounded-md text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name} ({p.ticket_prefix})</option>
            ))}
          </select>
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onProjectManagerOpen}>Projects</Button>
        {!isLocal && (
          <Button variant="outline" onClick={onToggleSpawnForm}>
            {showSpawnForm ? 'Close' : 'Spawn Sub-Agent'}
          </Button>
        )}
        <Button onClick={onCreateTask}>+ New Task</Button>
        <Button variant="ghost" size="icon-sm" onClick={onRefresh} title="Refresh">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
            <path d="M13.5 2v3h-3M2.5 14v-3h3" />
          </svg>
        </Button>
      </div>
    </div>
  )
}
