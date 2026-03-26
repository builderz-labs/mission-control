'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMissionControl } from '@/store/index'
import type { Agent } from '@/store/index'
import type { UnifiedAgent } from '@/lib/types/agent-status'

interface UseAgentStatusOptions {
  pollInterval?: number
  enabled?: boolean
}

interface UseAgentStatusResult {
  agents: UnifiedAgent[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useAgentStatus(options: UseAgentStatusOptions = {}): UseAgentStatusResult {
  const { pollInterval = 10000, enabled = true } = options

  const storeAgents = useMissionControl((state) => state.agents)
  const setAgents = useMissionControl((state) => state.setAgents)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)

  const fetchAgents = useCallback(async () => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/agents', {
        signal: controller.signal,
        cache: 'no-store',
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch agents: ${res.status} ${res.statusText}`)
      }

      const data: { agents?: Agent[] } = await res.json()
      const agentList = Array.isArray(data?.agents) ? data.agents : []

      if (isMountedRef.current) {
        setAgents(agentList)
        setError(null)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error fetching agents')
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [setAgents])

  useEffect(() => {
    isMountedRef.current = true

    if (!enabled) {
      return
    }

    // Immediate fetch on mount or when re-enabled
    fetchAgents()

    // Set up polling interval
    intervalRef.current = setInterval(fetchAgents, pollInterval)

    return () => {
      isMountedRef.current = false

      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [enabled, pollInterval, fetchAgents])

  return {
    agents: storeAgents as UnifiedAgent[],
    isLoading,
    error,
    refetch: fetchAgents,
  }
}
