'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMissionControl, type Agent } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { Task, Project } from './task-board/types'
import { statusColumns } from './task-board/types'
import { BoardColumn } from './task-board/board-column'
import { TaskDetailModal } from './task-board/task-detail-modal'
import { CreateTaskModal } from './task-board/create-task-modal'
import { EditTaskModal } from './task-board/edit-task-modal'
import { ProjectManagerModal } from './task-board/project-manager-modal'

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

  const tasks: Task[] = storeTasks.map(t => ({
    ...t,
    aegisApproved: Boolean(aegisMap[t.id])
  }))

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

  useSmartPoll(fetchData, 30000, { pauseWhenSseConnected: true })

  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>)

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

      updateTask(draggedTask.id, {
        status: newStatus as Task['status'],
        updated_at: Math.floor(Date.now() / 1000)
      })

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
      updateTask(draggedTask.id, { status: previousStatus })
      setError(err instanceof Error ? err.message : 'Failed to update task status')
    } finally {
      setDraggedTask(null)
    }
  }

  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task)
    updateTaskUrl(task.id)
  }, [setSelectedTask, updateTaskUrl])

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
          <BoardColumn
            key={column.key}
            columnKey={column.key}
            title={column.title}
            color={column.color}
            tasks={tasksByStatus[column.key] || []}
            draggedTaskId={draggedTask?.id ?? null}
            getAgentName={getAgentName}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onTaskClick={handleTaskClick}
          />
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
