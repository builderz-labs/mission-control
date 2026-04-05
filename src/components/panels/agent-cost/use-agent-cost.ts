'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClientLogger } from '@/lib/client-logger'
import type {
  Timeframe,
  ActiveView,
  ExpandedSection,
  AgentCostsResponse,
  ByAgentResponse,
  TaskCostsResponse,
  TaskCostEntry,
  PieSlice,
  TrendPoint,
  EfficiencyBar,
} from './types'

const log = createClientLogger('AgentCostPanel')
const REFRESH_INTERVAL = 30_000 // visibility-driven 30s auto-refresh

// Maps UI timeframe labels to the days param used by /api/tokens/by-agent
const timeframeToDays = (tf: Timeframe): number => {
  switch (tf) {
    case 'hour': return 1
    case 'day': return 1
    case 'week': return 7
    case 'month': return 30
  }
}

export function useAgentCost() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('day')
  const [data, setData] = useState<AgentCostsResponse | null>(null)
  const [taskData, setTaskData] = useState<TaskCostsResponse | null>(null)
  const [byAgentData, setByAgentData] = useState<ByAgentResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>('tasks')
  const [activeView, setActiveView] = useState<ActiveView>('overview')
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const [agentRes, taskRes, byAgentRes] = await Promise.all([
        fetch(`/api/tokens?action=agent-costs&timeframe=${selectedTimeframe}`),
        fetch(`/api/tokens?action=task-costs&timeframe=${selectedTimeframe}`),
        fetch(`/api/tokens/by-agent?days=${timeframeToDays(selectedTimeframe)}`),
      ])
      const [agentJson, taskJson, byAgentJson] = await Promise.all([
        agentRes.json(),
        taskRes.json(),
        byAgentRes.json(),
      ])
      setData(agentJson)
      setTaskData(taskJson)
      setByAgentData(byAgentJson)
    } catch (err) {
      log.error('Failed to load agent costs:', err)
      setError('Failed to load agent costs. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    refreshTimer.current = setInterval(loadData, REFRESH_INTERVAL)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadData])

  const getAgentTasks = useCallback(
    (agentName: string): TaskCostEntry[] => {
      if (!taskData) return []
      const agentEntry = taskData.agents[agentName]
      if (!agentEntry) return []
      return taskData.tasks.filter((t) => agentEntry.taskIds.includes(t.taskId))
    },
    [taskData]
  )

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
    return num.toString()
  }

  const formatCost = (cost: number): string => '$' + cost.toFixed(4)

  // Derived — computed without mutation
  const agents = data?.agents ? Object.entries(data.agents) : []
  const sortedAgents = [...agents].sort(([, a], [, b]) => b.stats.totalCost - a.stats.totalCost)
  const totalCost = agents.reduce((sum, [, a]) => sum + a.stats.totalCost, 0)

  const mostExpensive = sortedAgents[0] ?? null
  const mostEfficient =
    agents.length > 0
      ? agents.reduce((best, curr) => {
          const currRate = curr[1].stats.totalCost / Math.max(1, curr[1].stats.totalTokens) * 1000
          const bestRate = best[1].stats.totalCost / Math.max(1, best[1].stats.totalTokens) * 1000
          return currRate < bestRate ? curr : best
        })
      : null

  const pieData: PieSlice[] = sortedAgents
    .slice(0, 8)
    .map(([name, a]) => ({ name, value: a.stats.totalCost }))

  const top5 = sortedAgents.slice(0, 5).map(([name]) => name)
  const allDates = new Set<string>()
  for (const [name, a] of agents) {
    if (top5.includes(name)) {
      for (const t of a.timeline) allDates.add(t.date)
    }
  }
  const trendData: TrendPoint[] = [...allDates].sort().map((date) => {
    const point: TrendPoint = { date: date.slice(5) } // MM-DD
    for (const name of top5) {
      const entry = data?.agents[name]?.timeline.find((t) => t.date === date)
      point[name] = entry?.cost ?? 0
    }
    return point
  })

  const efficiencyData: EfficiencyBar[] = sortedAgents.map(([name, a]) => ({
    name,
    costPer1k: (a.stats.totalCost / Math.max(1, a.stats.totalTokens)) * 1000,
  }))

  return {
    selectedTimeframe,
    setSelectedTimeframe,
    data,
    taskData,
    byAgentData,
    isLoading,
    error,
    clearError: () => setError(null),
    expandedAgent,
    setExpandedAgent,
    expandedSection,
    setExpandedSection,
    activeView,
    setActiveView,
    loadData,
    getAgentTasks,
    formatNumber,
    formatCost,
    // Derived
    agents,
    sortedAgents,
    totalCost,
    mostExpensive,
    mostEfficient,
    pieData,
    top5,
    trendData,
    efficiencyData,
  }
}
