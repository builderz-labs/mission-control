'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { getAgentIdentity, isAgentHidden, type FleetTier } from '@/lib/agent-identity'

type DispatchState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'success'; agentHandle: string; agentName: string; timestamp: string }
  | { phase: 'error'; message: string }

/** Dispatch record exposed to parent (Lab page) for the Recent Dispatches section */
export interface DispatchRecord {
  id: string
  time: string
  agent: string
  agentHandle: string
  operation: string
  status: 'success' | 'error'
}

interface DispatchFormProps {
  className?: string
  onDispatched?: (record: DispatchRecord) => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground select-none">{children}</span>
}

/**
 * Static list of Twin agents that should always appear in the picker,
 * even if they haven't connected to the gateway yet.
 * These are the 5 core Primary Fleet agents at build.twin.so.
 */
const STATIC_PRIMARY_AGENTS = [
  'github-intelligence-agent',
  'engineering-summary-interpreter',
  'clickup-super-agent-orchestrator',
  'airweave-context-agent',
  'claude-code-dispatch-agent',
]

/** Fetch schedule parse preview from the server API */
async function fetchSchedulePreview(input: string): Promise<string | null> {
  const s = input.trim()
  if (!s) return null
  if (/^now$/i.test(s) || /^immediately$/i.test(s)) return 'Runs: once now'
  try {
    const res = await fetch(`/api/schedule-parse?input=${encodeURIComponent(s)}`)
    if (!res.ok) return `Runs: "${s}"`
    const data = await res.json()
    return data.humanReadable ? `Runs: ${data.humanReadable}` : `Runs: "${s}"`
  } catch {
    return `Runs: "${s}"`
  }
}

export function DispatchForm({ className, onDispatched }: DispatchFormProps) {
  const { agents } = useMissionControl()
  const [operation, setOperation] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [schedule, setSchedule] = useState('')
  const [schedulePreview, setSchedulePreview] = useState<string | null>(null)
  const [dispatchState, setDispatchState] = useState<DispatchState>({ phase: 'idle' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scheduleDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Build agent list from store, excluding hidden agents, sorted by fleet tier
  // Also inject static Twin agents that may not be connected yet
  const dispatchableAgents = useMemo(() => {
    const tierOrder: Record<string, number> = { operator: 0, primary: 1, devtools: 2, hidden: 3 }
    const seenNames = new Set<string>()

    // Start with live agents from the store
    const liveAgents = agents
      .filter(a => !isAgentHidden(a.name))
      .map(a => {
        const identity = getAgentIdentity(a.name)
        seenNames.add(a.name)
        return {
          id: a.name,
          dbId: a.id,
          roleTitle: identity.roleTitle,
          tier: identity.tier,
          tierOrder: tierOrder[identity.tier] ?? 2,
          icon: identity.icon,
          status: a.status,
          name: a.name,
        }
      })

    // Inject static primary agents that aren't already in the store
    const staticAgents = STATIC_PRIMARY_AGENTS
      .filter(slug => !seenNames.has(slug))
      .map(slug => {
        const identity = getAgentIdentity(slug)
        return {
          id: slug,
          dbId: 0,
          roleTitle: identity.roleTitle,
          tier: identity.tier as FleetTier,
          tierOrder: tierOrder[identity.tier] ?? 1,
          icon: identity.icon,
          status: 'offline' as const,
          name: slug,
        }
      })

    return [...liveAgents, ...staticAgents].sort((a, b) => {
      if (a.tierOrder !== b.tierOrder) return a.tierOrder - b.tierOrder
      return a.roleTitle.localeCompare(b.roleTitle)
    })
  }, [agents])

  // Auto-select first agent if none selected
  useEffect(() => {
    if (!selectedAgentId && dispatchableAgents.length > 0) {
      setSelectedAgentId(dispatchableAgents[0].id)
    }
  }, [dispatchableAgents, selectedAgentId])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [operation])

  // Debounced schedule preview (Fix 6) — calls server-side parser
  useEffect(() => {
    if (scheduleDebounceRef.current) clearTimeout(scheduleDebounceRef.current)
    if (!schedule.trim()) {
      setSchedulePreview(null)
      return
    }
    scheduleDebounceRef.current = setTimeout(() => {
      fetchSchedulePreview(schedule).then(preview => setSchedulePreview(preview))
    }, 500)
    return () => {
      if (scheduleDebounceRef.current) clearTimeout(scheduleDebounceRef.current)
    }
  }, [schedule])

  const canSubmit = operation.trim().length > 0 && selectedAgentId.trim().length > 0 && dispatchState.phase !== 'sending'

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const agent = dispatchableAgents.find(a => a.id === selectedAgentId)
    const operationText = operation.trim()
    setDispatchState({ phase: 'sending' })
    try {
      const res = await fetch('/api/jarvis/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: operationText,
          agent_id: selectedAgentId,
          schedule: schedule.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Dispatch failed (${res.status})`)
      }
      const now = new Date()
      const timestamp = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const agentHandle = `@${selectedAgentId}`
      const agentName = agent?.roleTitle ?? 'agent'

      setDispatchState({ phase: 'success', agentHandle, agentName, timestamp })
      setOperation('')
      setSchedule('')
      setSchedulePreview(null)
      textareaRef.current?.focus()

      // Notify parent (Lab page) for Recent Dispatches
      onDispatched?.({
        id: `dispatch-${Date.now()}`,
        time: timestamp,
        agent: agentName,
        agentHandle,
        operation: operationText,
        status: 'success',
      })

      // Auto-clear after 10 seconds (Fix 3)
      setTimeout(() => setDispatchState((prev) => prev.phase === 'success' ? { phase: 'idle' } : prev), 10_000)
    } catch (err: any) {
      setDispatchState({ phase: 'error', message: err?.message ?? 'Dispatch failed' })

      // Notify parent of failure too
      onDispatched?.({
        id: `dispatch-${Date.now()}`,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        agent: agent?.roleTitle ?? 'agent',
        agentHandle: `@${selectedAgentId}`,
        operation: operation.trim(),
        status: 'error',
      })
    }
  }, [canSubmit, dispatchableAgents, onDispatched, operation, schedule, selectedAgentId])

  // Group agents by tier for the dropdown
  const tierLabels: Record<string, string> = {
    operator: 'Operator',
    primary: 'Primary Fleet',
    devtools: 'Dev Tools',
  }

  // Build optgroups
  const tiers = useMemo(() => {
    const groups: Record<string, typeof dispatchableAgents> = {}
    for (const agent of dispatchableAgents) {
      const key = agent.tier
      if (!groups[key]) groups[key] = []
      groups[key].push(agent)
    }
    return Object.entries(groups).sort(([, a], [, b]) => (a[0]?.tierOrder ?? 0) - (b[0]?.tierOrder ?? 0))
  }, [dispatchableAgents])

  return (
    <section className={className}>
      <div className="desk-panel p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_220px_220px_auto] md:items-end">
          <label className="grid gap-2">
            <FieldLabel>Operation</FieldLabel>
            <textarea
              ref={textareaRef}
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Describe the operation... (⌘+Enter to dispatch)"
              className="min-h-[104px] w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>

          <label className="grid gap-2">
            <FieldLabel>Agent</FieldLabel>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              {dispatchableAgents.length === 0 && (
                <option value="" disabled>No agents connected</option>
              )}
              {tiers.map(([tier, tierAgents]) => (
                <optgroup key={tier} label={tierLabels[tier] ?? tier}>
                  {tierAgents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.roleTitle}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <FieldLabel>Schedule</FieldLabel>
            <input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="Leave blank to run immediately"
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
            {/* Schedule parse preview (Fix 6) */}
            {schedulePreview && (
              <p className="text-2xs text-muted-foreground mt-1 ml-1 animate-in fade-in duration-200">
                {schedulePreview}
              </p>
            )}
          </label>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-11 rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          >
            {dispatchState.phase === 'sending' ? 'Dispatching\u2026' : 'Dispatch'}
          </Button>
        </div>

        {/* Inline feedback (Fix 3) — no toast, no banner */}
        {dispatchState.phase === 'error' && (
          <p className="mt-3 text-sm text-destructive animate-in fade-in duration-200">
            {dispatchState.message}
          </p>
        )}
        {dispatchState.phase === 'success' && (
          <p className="mt-3 text-sm text-success animate-in fade-in duration-200">
            Dispatched to {dispatchState.agentHandle} &middot; {dispatchState.timestamp}
          </p>
        )}
      </div>
    </section>
  )
}
