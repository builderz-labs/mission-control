'use client'

import { useState, useCallback, useRef } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import type {
  TimeWindow,
  SessionFilter,
  SortBy,
  TokenUsage,
  ModelInfo,
  Session,
} from './types'

const log = createClientLogger('SessionDetails')

// ms values keyed by TimeWindow — used for recency filtering
const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'all': Infinity,
}

export function useSessionDetails() {
  const { sessions, selectedSession, setSelectedSession, setSessions, availableModels } =
    useMissionControl()

  // Smart polling — pauses when SSE stream is connected
  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/sessions', { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setSessions(data.sessions || data)
    } catch (error) {
      log.error('Failed to load sessions:', error)
    }
  }, [setSessions])

  useSmartPoll(loadSessions, 60000, { pauseWhenConnected: true })

  const [controllingSession, setControllingSession] = useState<string | null>(null)
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('age')
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all')
  const [includeGlobal, setIncludeGlobal] = useState(true)
  const [includeUnknown, setIncludeUnknown] = useState(true)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')
  const labelInputRef = useRef<HTMLInputElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const getModelInfo = useCallback(
    (modelName: string): ModelInfo => {
      const matchedAlias = availableModels
        .map((m) => m.alias)
        .find((alias) => modelName.toLowerCase().includes(alias.toLowerCase()))

      return (
        availableModels.find(
          (m) => m.name === modelName || m.alias === modelName || m.alias === matchedAlias
        ) ?? { alias: modelName, name: modelName, provider: 'unknown', description: 'Unknown model' }
      )
    },
    [availableModels]
  )

  const parseTokenUsage = (tokenString: string): TokenUsage => {
    const match = tokenString.match(
      /(\d+(?:\.\d+)?)(k|m)?\/(\d+(?:\.\d+)?)(k|m)?\s*\((\d+(?:\.\d+)?)%\)/
    )
    if (!match) return { used: 0, total: 0, percentage: 0 }

    const used =
      parseFloat(match[1]) * (match[2] === 'k' ? 1000 : match[2] === 'm' ? 1_000_000 : 1)
    const total =
      parseFloat(match[3]) * (match[4] === 'k' ? 1000 : match[4] === 'm' ? 1_000_000 : 1)
    const percentage = parseFloat(match[5])

    return { used, total, percentage }
  }

  const getSessionTypeIcon = (sessionKey: string): string => {
    if (sessionKey.includes(':main:main')) return '👑'
    if (sessionKey.includes(':subagent:')) return '🤖'
    if (sessionKey.includes(':cron:')) return '⏰'
    if (sessionKey.includes(':group:')) return '👥'
    if (sessionKey.includes(':global:')) return '🌐'
    return '💬'
  }

  const getSessionType = (sessionKey: string): string => {
    if (sessionKey.includes(':main:main')) return 'Main'
    if (sessionKey.includes(':subagent:')) return 'Sub-agent'
    if (sessionKey.includes(':cron:')) return 'Cron'
    if (sessionKey.includes(':group:')) return 'Group'
    if (sessionKey.includes(':global:')) return 'Global'
    return 'Unknown'
  }

  const getSessionStatus = (session: Session): string => {
    if (!session.active) return 'idle'
    const { percentage } = parseTokenUsage(session.tokens)
    if (percentage > 95) return 'critical'
    if (percentage > 80) return 'warning'
    return 'active'
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active': return 'text-green-400'
      case 'warning': return 'text-yellow-400'
      case 'critical': return 'text-red-400'
      default: return 'text-muted-foreground'
    }
  }

  const filteredSessions = sessions.filter((session) => {
    if (sessionFilter === 'active' && !session.active) return false
    if (sessionFilter === 'idle' && session.active) return false
    if (timeWindow !== 'all' && session.lastActivity) {
      if (session.lastActivity < Date.now() - TIME_WINDOW_MS[timeWindow]) return false
    }
    if (!includeGlobal && session.key?.includes(':global:')) return false
    if (!includeUnknown && getSessionType(session.key) === 'Unknown') return false
    return true
  })

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    switch (sortBy) {
      case 'tokens':
        return parseTokenUsage(b.tokens).percentage - parseTokenUsage(a.tokens).percentage
      case 'model':
        return a.model.localeCompare(b.model)
      default: // 'age'
        if (a.age === 'just now') return -1
        if (b.age === 'just now') return 1
        return a.age.localeCompare(b.age)
    }
  })

  const handleSessionSelect = (session: Session): void => {
    setSelectedSession(session.id)
    setExpandedSession(expandedSession === session.id ? null : session.id)
  }

  const sendSessionAction = async (
    action: string,
    sessionKey: string,
    payload: Record<string, unknown>,
    method: 'POST' | 'DELETE' = 'POST'
  ): Promise<boolean> => {
    const lockKey = `${action}-${sessionKey}`
    setControllingSession(lockKey)
    try {
      const url =
        method === 'DELETE' ? '/api/sessions' : `/api/sessions?action=${action}`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, ...payload }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || `Failed: ${action}`)
        return false
      }
      return true
    } catch {
      alert(`Failed: ${action}`)
      return false
    } finally {
      setControllingSession(null)
    }
  }

  const handleLabelSave = async (sessionKey: string): Promise<void> => {
    if (editingLabel !== sessionKey) return
    await sendSessionAction('set-label', sessionKey, { label: labelValue })
    setEditingLabel(null)
  }

  const handleDeleteSession = async (sessionKey: string): Promise<void> => {
    const ok = await sendSessionAction('delete', sessionKey, {}, 'DELETE')
    if (ok) {
      setConfirmingDelete(null)
      loadSessions()
    }
  }

  return {
    // Store data
    sessions,
    selectedSession,
    // Filtered/sorted
    sortedSessions,
    filteredSessions,
    // Filter state
    sessionFilter,
    setSessionFilter,
    sortBy,
    setSortBy,
    timeWindow,
    setTimeWindow,
    includeGlobal,
    setIncludeGlobal,
    includeUnknown,
    setIncludeUnknown,
    // Expand state
    expandedSession,
    // Label editing
    editingLabel,
    setEditingLabel,
    labelValue,
    setLabelValue,
    labelInputRef,
    // Delete confirmation
    confirmingDelete,
    setConfirmingDelete,
    // Control state
    controllingSession,
    setControllingSession,
    // Helpers
    getModelInfo,
    parseTokenUsage,
    getSessionTypeIcon,
    getSessionType,
    getSessionStatus,
    getStatusColor,
    // Handlers
    handleSessionSelect,
    sendSessionAction,
    handleLabelSave,
    handleDeleteSession,
    loadSessions,
  }
}
