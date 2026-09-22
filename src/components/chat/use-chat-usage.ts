'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { buildUsageTracker, type UsageTracker } from '@/lib/chat-usage-tracker'

const EMPTY: UsageTracker = buildUsageTracker({
  kind: 'claude-code',
  fiveHourPercent: 0,
  weeklyPercent: 0,
  extraPercent: 0,
  extraLabel: 'Weekly · extra',
  fiveHourResetsAt: Date.now() + 5 * 60 * 60 * 1000,
  weeklyResetsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  contextPercent: 0,
})

export function useChatUsage(kind: string, tokens?: string, model?: string) {
  const [tracker, setTracker] = useState<UsageTracker>(EMPTY)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ kind, tokens: tokens || '', model: model || '' })
    try {
      const data = await apiFetch<{ tracker?: UsageTracker }>(`/api/chat/usage?${params.toString()}`)
      if (data.tracker?.limits?.length === 3) setTracker(data.tracker)
    } catch {
      /* keep last snapshot */
    }
  }, [kind, tokens, model])

  useEffect(() => { void load() }, [load])
  useSmartPoll(load, 15_000, { enabled: true })
  return tracker
}
