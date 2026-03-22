'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { getAgentIdentity, isAgentHidden } from '@/lib/agent-identity'

type DispatchState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'success'; agentName: string }
  | { phase: 'error'; message: string }

interface DispatchFormProps {
  className?: string
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground select-none">{children}</span>
}

export function DispatchForm({ className }: DispatchFormProps) {
  const { agents } = useMissionControl()
  const [operation, setOperation] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [schedule, setSchedule] = useState('')
  const [dispatchState, setDispatchState] = useState<DispatchState>({ phase: 'idle' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Build agent list from store, excluding hidden agents, sorted by fleet tier
  const dispatchableAgents = useMemo(() => {
    const tierOrder: Record<string, number> = { operator: 0, primary: 1, devtools: 2, hidden: 3 }
    return agents
      .filter(a => !isAgentHidden(a.name))
      .map(a => {
        const identity = getAgentIdentity(a.name)
        return {
          id: a.name, // agent name is the dispatch identifier
          dbId: a.id,
          roleTitle: identity.roleTitle,
          tier: identity.tier,
          tierOrder: tierOrder[identity.tier] ?? 2,
          icon: identity.icon,
          status: a.status,
          name: a.name,
        }
      })
      .sort((a, b) => {
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

  const canSubmit = operation.trim().length > 0 && selectedAgentId.trim().length > 0 && dispatchState.phase !== 'sending'

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const agent = dispatchableAgents.find(a => a.id === selectedAgentId)
    setDispatchState({ phase: 'sending' })
    try {
      const res = await fetch('/api/jarvis/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: operation.trim(),
          agent_id: selectedAgentId,
          schedule: schedule.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Dispatch failed (${res.status})`)
      }
      setDispatchState({ phase: 'success', agentName: agent?.roleTitle ?? 'agent' })
      setOperation('')
      setSchedule('')
      textareaRef.current?.focus()
      setTimeout(() => setDispatchState((prev) => prev.phase === 'success' ? { phase: 'idle' } : prev), 3000)
    } catch (err: any) {
      setDispatchState({ phase: 'error', message: err?.message ?? 'Dispatch failed' })
    }
  }, [canSubmit, dispatchableAgents, operation, schedule, selectedAgentId])

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
                      {agent.icon} {agent.roleTitle}
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
              placeholder="Now / plain English..."
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-11 rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          >
            {dispatchState.phase === 'sending' ? 'Dispatching...' : 'Dispatch'}
          </Button>
        </div>

        {dispatchState.phase === 'error' && (
          <p className="mt-3 text-sm text-destructive">{dispatchState.message}</p>
        )}
        {dispatchState.phase === 'success' && (
          <p className="mt-3 text-sm text-success">Dispatched to {dispatchState.agentName}</p>
        )}
      </div>
    </section>
  )
}
