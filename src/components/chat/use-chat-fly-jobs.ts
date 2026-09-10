'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { FlyActivity, FlyActivityJob } from '@/lib/fly-activity'
import { useSmartPoll } from '@/lib/use-smart-poll'

export function useChatFlyJobs(): FlyActivityJob[] {
  const [jobs, setJobs] = useState<FlyActivityJob[]>([])
  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ activity?: FlyActivity }>('/api/fly/status', { signal: AbortSignal.timeout(8000) })
      setJobs(data.activity?.jobs || [])
    } catch {
      setJobs([])
    }
  }, [])
  useSmartPoll(refresh, 5000, { pauseWhenSseConnected: false })
  useEffect(() => {
    const onFly = () => { void refresh() }
    window.addEventListener('mission-control:fly-worker-updated', onFly)
    return () => window.removeEventListener('mission-control:fly-worker-updated', onFly)
  }, [refresh])
  return jobs
}
