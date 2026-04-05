'use client'

// Encapsulates all agent data-fetching and derived agent list logic.
// Kept separate so the main shell only orchestrates rendering, not data.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Agent } from '@/store'
import type { SessionAgentRow } from './office-types'
import { isInactiveLocalSession } from './office-utils'

interface UseOfficeAgentsInput {
  readonly isLocalMode: boolean
  readonly storeAgents: Agent[]
}

export interface UseOfficeAgentsOutput {
  readonly loading: boolean
  readonly localBootstrapping: boolean
  readonly error: string | null
  readonly setError: (e: string | null) => void
  readonly fetchAgents: () => Promise<void>
  readonly visibleDisplayAgents: Agent[]
  readonly displayAgents: Agent[]
  readonly counts: Readonly<{ idle: number; busy: number; error: number; offline: number }>
  readonly localSessionFilter: 'running' | 'not-running'
  readonly setLocalSessionFilter: (v: 'running' | 'not-running') => void
}

export function useOfficeAgents({
  isLocalMode,
  storeAgents,
}: UseOfficeAgentsInput): UseOfficeAgentsOutput {
  const [localAgents, setLocalAgents] = useState<Agent[]>([])
  const [sessionAgents, setSessionAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [localBootstrapping, setLocalBootstrapping] = useState(isLocalMode)
  const [error, setError] = useState<string | null>(null)
  const [localSessionFilter, setLocalSessionFilter] = useState<'running' | 'not-running'>('running')
  const localBootstrapRetries = useRef(0)

  const fetchAgents = useCallback(async (): Promise<void> => {
    let nextLocalAgents: Agent[] = []
    let nextSessionAgents: Agent[] = []
    setError(null)

    try {
      const [agentRes, sessionRes] = await Promise.all([
        fetch('/api/agents', { signal: AbortSignal.timeout(8000) }),
        isLocalMode ? fetch('/api/sessions', { signal: AbortSignal.timeout(8000) }) : Promise.resolve(null),
      ])

      if (agentRes.ok) {
        const data = await agentRes.json()
        nextLocalAgents = Array.isArray(data.agents) ? data.agents : []
        setLocalAgents(nextLocalAgents)
      }

      if (isLocalMode && sessionRes?.ok) {
        nextSessionAgents = buildSessionAgents(await sessionRes.json().catch(() => ({})))
        setSessionAgents(nextSessionAgents)
      }
    } catch {
      setError('Failed to load. Please try again.')
    }

    if (isLocalMode) {
      const hasAnyAgents = nextLocalAgents.length > 0 || nextSessionAgents.length > 0
      if (hasAnyAgents) { setLocalBootstrapping(false) }
      if (!hasAnyAgents && localBootstrapRetries.current < 5) {
        localBootstrapRetries.current += 1
        setLoading(true)
        setTimeout(() => { void fetchAgents() }, 700)
        return
      }
    }

    setLoading(false)
  }, [isLocalMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchAgents() }, [fetchAgents])

  useEffect(() => {
    if (!isLocalMode) { setLocalBootstrapping(false); return }
    setLocalBootstrapping(true)
    const bootstrapTimer = setTimeout(() => setLocalBootstrapping(false), 4500)
    return () => clearTimeout(bootstrapTimer)
  }, [isLocalMode])

  useEffect(() => {
    const interval = setInterval(fetchAgents, 10000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  const displayAgents = useMemo((): Agent[] => {
    if (storeAgents.length > 0) return storeAgents
    if (isLocalMode) return mergeAgents(sessionAgents, localAgents)
    if (localAgents.length > 0) return localAgents
    return []
  }, [storeAgents, isLocalMode, localAgents, sessionAgents])

  const visibleDisplayAgents = useMemo((): Agent[] => {
    if (!isLocalMode) return displayAgents
    if (localSessionFilter === 'not-running') return displayAgents.filter(isInactiveLocalSession)
    return displayAgents.filter((a) => !isInactiveLocalSession(a))
  }, [displayAgents, isLocalMode, localSessionFilter])

  const counts = useMemo(() => {
    const c = { idle: 0, busy: 0, error: 0, offline: 0 }
    for (const a of visibleDisplayAgents) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [visibleDisplayAgents])

  return {
    loading,
    localBootstrapping,
    error,
    setError,
    fetchAgents,
    visibleDisplayAgents,
    displayAgents,
    counts,
    localSessionFilter,
    setLocalSessionFilter,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSessionAgents(sessionJson: unknown): Agent[] {
  const rows = Array.isArray((sessionJson as { sessions?: unknown })?.sessions)
    ? ((sessionJson as { sessions: SessionAgentRow[] }).sessions)
    : []
  const byAgent = new Map<string, Agent>()
  let idx = 0

  for (const row of rows) {
    const name = String(row.agent || '').trim()
    if (!name) continue
    const existing = byAgent.get(name)
    const nowSec = Math.floor(Date.now() / 1000)
    const lastSeenSec = row.lastActivity ? Math.floor(row.lastActivity / 1000) : nowSec
    const candidate: Agent = {
      id: -5000 - idx,
      name,
      role: String(row.kind || 'local-session'),
      status: row.active ? 'busy' : 'idle',
      last_seen: lastSeenSec,
      last_activity: `${row.kind || 'session'} · ${row.model || 'unknown model'}`,
      session_key: row.key || row.id,
      created_at: nowSec,
      updated_at: nowSec,
      config: {
        localSession: {
          sessionId: row.id,
          key: row.key,
          workingDir: row.workingDir ?? null,
          kind: row.kind || 'session',
        },
      },
    }
    const existingLastSeen = existing?.last_seen ?? 0
    const candidateLastSeen = candidate.last_seen ?? 0
    const shouldReplace =
      !existing ||
      (existing.status !== 'busy' && candidate.status === 'busy') ||
      (existing.status === candidate.status && candidateLastSeen > existingLastSeen)
    if (shouldReplace) { byAgent.set(name, candidate); idx += 1 }
  }

  return Array.from(byAgent.values())
}

function mergeAgents(sessionAgents: Agent[], localAgents: Agent[]): Agent[] {
  const merged = new Map<string, Agent>()
  for (const agent of [...sessionAgents, ...localAgents]) {
    const key = String(agent.name || '').trim().toLowerCase()
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) { merged.set(key, agent); continue }
    const existingLastSeen = existing.last_seen ?? 0
    const candidateLastSeen = agent.last_seen ?? 0
    const shouldReplace =
      (existing.status !== 'busy' && agent.status === 'busy') ||
      (existing.status === agent.status && candidateLastSeen > existingLastSeen)
    if (shouldReplace) merged.set(key, agent)
  }
  return Array.from(merged.values())
}
