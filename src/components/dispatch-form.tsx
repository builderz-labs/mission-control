'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface JarvisAgent {
  id: string
  name: string
  description: string
  status: string | null
  webhook_url: string | null
  handle?: string | null
}

type AgentFetchState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; agents: JarvisAgent[] }
  | { phase: 'error'; message: string }

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

function agentLabel(agent: JarvisAgent): string {
  return `${agent.handle ?? `@${agent.id}`}${agent.name ? ` • ${agent.name}` : ''}`
}

export function DispatchForm({ className }: DispatchFormProps) {
  const [agentFetch, setAgentFetch] = useState<AgentFetchState>({ phase: 'idle' })
  const [operation, setOperation] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [schedule, setSchedule] = useState('')
  const [dispatchState, setDispatchState] = useState<DispatchState>({ phase: 'idle' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    setAgentFetch({ phase: 'loading' })
    fetch('/api/jarvis/agents')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `Registry returned ${res.status}`)
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const agents: JarvisAgent[] = Array.isArray(data?.agents) ? data.agents : []
        setAgentFetch({ phase: 'ready', agents })
        if (!selectedAgentId && agents[0]?.id) setSelectedAgentId(agents[0].id)
      })
      .catch((err) => {
        if (!cancelled) setAgentFetch({ phase: 'error', message: err?.message ?? 'Could not reach agent registry' })
      })
    return () => { cancelled = true }
  }, [selectedAgentId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [operation])

  const canSubmit = operation.trim().length > 0 && selectedAgentId.trim().length > 0 && dispatchState.phase !== 'sending'

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const agents = agentFetch.phase === 'ready' ? agentFetch.agents : []
    const agent = agents.find((a) => a.id === selectedAgentId) ?? null
    setDispatchState({ phase: 'sending' })
    try {
      const res = await fetch('/api/jarvis/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: operation.trim(), agent_id: selectedAgentId, schedule: schedule.trim() || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Dispatch failed (${res.status})`)
      }
      setDispatchState({ phase: 'success', agentName: agent?.name ?? 'agent' })
      setOperation('')
      setSchedule('')
      textareaRef.current?.focus()
      setTimeout(() => setDispatchState((prev) => prev.phase === 'success' ? { phase: 'idle' } : prev), 3000)
    } catch (err: any) {
      setDispatchState({ phase: 'error', message: err?.message ?? 'Dispatch failed' })
    }
  }, [agentFetch, canSubmit, operation, schedule, selectedAgentId])

  return (
    <section className={className}>
      <div className="rounded-2xl border border-white/10 bg-background/60 p-4 shadow-xl shadow-black/10">
        <div className="grid gap-4 md:grid-cols-[1fr_220px_220px_auto] md:items-end">
          <label className="grid gap-2">
            <FieldLabel>Operation</FieldLabel>
            <textarea ref={textareaRef} value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="Describe the operation..." className="min-h-[104px] w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm outline-none" />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Agent</FieldLabel>
            <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none">
              {(agentFetch.phase === 'ready' ? agentFetch.agents : []).map((agent) => <option key={agent.id} value={agent.id}>{agentLabel(agent)}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <FieldLabel>Schedule</FieldLabel>
            <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Now / plain English..." className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none" />
          </label>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">Dispatch</Button>
        </div>
        {dispatchState.phase === 'error' && <p className="mt-3 text-sm text-red-300">{dispatchState.message}</p>}
        {dispatchState.phase === 'success' && <p className="mt-3 text-sm text-emerald-300">Dispatched to {dispatchState.agentName}</p>}
      </div>
    </section>
  )
}
