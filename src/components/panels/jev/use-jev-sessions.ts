'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { JevSetupMessage, JevSetupRevision, JevSetupSession } from '@/lib/jev-setup-session-types'

export interface JevSessionDetail {
  session: JevSetupSession
  latestRevision: JevSetupRevision | null
  messages: JevSetupMessage[]
}

export function useJevSessions() {
  const [sessions, setSessions] = useState<JevSetupSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      const response = await apiFetch<{ sessions: JevSetupSession[] }>('/api/jev/sessions?limit=100')
      if (requestId !== requestRef.current) return
      setSessions(response.sessions)
      setError(null)
    } catch (cause) {
      if (requestId === requestRef.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load setup chats')
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const create = async (projectId: number, title: string) => {
    const response = await apiFetch<{ session: JevSetupSession }>('/api/jev/sessions', {
      method: 'POST', body: JSON.stringify({ projectId, title, provider: 'claude-cli', model: 'haiku' }),
    })
    return response.session
  }

  const load = async (id: string): Promise<JevSessionDetail> => {
    const [detail, messages] = await Promise.all([
      apiFetch<{ session: JevSetupSession; latestRevision: JevSetupRevision | null }>(`/api/jev/sessions/${id}`),
      apiFetch<{ messages: JevSetupMessage[] }>(`/api/jev/sessions/${id}/messages?limit=200`),
    ])
    return { ...detail, messages: messages.messages }
  }

  const markReady = async (id: string, primaryPolicyId: number) => {
    await apiFetch(`/api/jev/sessions/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready', primaryPolicyId }),
    })
    await refresh()
  }

  return { sessions, loading, error, refresh, create, load, markReady }
}
