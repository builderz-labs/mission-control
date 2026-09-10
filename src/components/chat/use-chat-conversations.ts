'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useMissionControl, type Agent } from '@/store'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { mapProviderSessions, readSessionPrefs, readSessions } from '@/lib/chat-session-map'

const log = createClientLogger('useChatConversations')

export function useChatConversations() {
  const { conversations, setConversations, agents, setAgents } = useMissionControl()
  const inFlightRef = useRef(false)

  const loadConversations = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const [sessionsData, prefs] = await Promise.all([
        apiFetch<unknown>('/api/sessions?include=archived').then(readSessions).catch(() => []),
        apiFetch<unknown>('/api/chat/session-prefs').then(readSessionPrefs).catch(() => ({})),
      ])
      setConversations(mapProviderSessions(sessionsData, prefs))
    } catch (err) {
      log.error('Failed to load conversations:', err)
    } finally {
      inFlightRef.current = false
    }
  }, [setConversations])

  useSmartPoll(loadConversations, 5000, { pauseWhenSseConnected: false })

  useEffect(() => {
    apiFetch<{ agents?: Agent[] }>('/api/agents')
      .then((data) => {
        if (data.agents) setAgents(data.agents)
      })
      .catch((err) => log.error('Failed to load agents:', err))
  }, [setAgents])

  return { conversations, agents, reload: loadConversations }
}
