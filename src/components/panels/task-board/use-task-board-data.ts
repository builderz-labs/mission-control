import { useState, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent, Project, Task } from './task-board-types'

interface TaskBoardData {
  agents: Agent[]
  projects: Project[]
  aegisMap: Record<number, boolean>
  loading: boolean
  error: string | null
  fetchData: () => Promise<void>
  clearError: () => void
}

/** Fetches tasks, agents, projects and Aegis approval state for the task board. */
export function useTaskBoardData(projectFilter: string): TaskBoardData {
  const { setTasks: storeSetTasks } = useMissionControl()

  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aegisMap, setAegisMap] = useState<Record<number, boolean>>({})

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      const tasksQuery = new URLSearchParams()
      if (projectFilter !== 'all') tasksQuery.set('project_id', projectFilter)
      const tasksUrl = tasksQuery.toString() ? `/api/tasks?${tasksQuery.toString()}` : '/api/tasks'

      const [tasksRes, agentsRes, projectsRes] = await Promise.all([
        fetch(tasksUrl),
        fetch('/api/agents'),
        fetch('/api/projects'),
      ])

      if (!tasksRes.ok || !agentsRes.ok || !projectsRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const [tasksData, agentsData, projectsData] = await Promise.all([
        tasksRes.json(),
        agentsRes.json(),
        projectsRes.json(),
      ])

      const tasksList: Task[] = tasksData.tasks || []
      const taskIds = tasksList.map((t) => t.id)

      // Render board immediately; hydrate Aegis approvals in background
      storeSetTasks(tasksList)
      setAgents(agentsData.agents || [])
      setProjects(projectsData.projects || [])

      if (taskIds.length > 0) {
        fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((reviewData) => {
            const latest = reviewData?.latest || {}
            const newMap: Record<number, boolean> = Object.fromEntries(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved',
              ])
            )
            setAegisMap(newMap)
          })
          .catch(() => setAegisMap({}))
      } else {
        setAegisMap({})
      }
    } catch (err) {
      setError(err instanceof Error ? getErrorMessage(err) : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [projectFilter, storeSetTasks])

  return { agents, projects, aegisMap, loading, error, fetchData, clearError: () => setError(null) }
}
