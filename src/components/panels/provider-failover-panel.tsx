'use client'

import { useState, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Button } from '@/components/ui/button'
import { AddForm, EMPTY_FORM, RoutingRule, ProviderHealth } from './provider-failover/types'
import { AddProviderForm } from './provider-failover/AddProviderForm'
import { RoutingTable } from './provider-failover/RoutingTable'
import { HealthCard } from './provider-failover/HealthCard'

export function ProviderFailoverPanel(): React.JSX.Element {
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [health, setHealth] = useState<ProviderHealth[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [healthLoading, setHealthLoading] = useState(true)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const showFeedback = useCallback((ok: boolean, text: string): void => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }, [])

  const fetchRules = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/providers/routing', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRules(Array.isArray(data.rules) ? data.rules : [])
      setRulesError(null)
    } catch {
      setRulesError('Failed to load routing rules.')
    } finally {
      setRulesLoading(false)
    }
  }, [])

  const fetchHealth = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/providers/health', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setHealth(Array.isArray(data.health) ? data.health : [])
      setHealthError(null)
    } catch {
      setHealthError('Failed to load health data.')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useSmartPoll(fetchRules, 30_000)
  useSmartPoll(fetchHealth, 30_000)

  const handleAddSubmit = useCallback(async (): Promise<void> => {
    if (!addForm.provider.trim()) return
    setSubmitting(true)
    try {
      const tags = addForm.capability_tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const body = {
        provider: addForm.provider.trim(),
        ...(addForm.priority !== '' && { priority: Number(addForm.priority) }),
        max_retries: Number(addForm.max_retries),
        timeout_ms: Number(addForm.timeout_ms),
        capability_tags: tags,
      }

      const res = await fetch('/api/providers/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setAddForm(EMPTY_FORM)
      setShowAddForm(false)
      showFeedback(true, 'Provider added successfully.')
      await fetchRules()
    } catch (err) {
      showFeedback(false, err instanceof Error ? err.message : 'Failed to add provider.')
    } finally {
      setSubmitting(false)
    }
  }, [addForm, fetchRules, showFeedback])

  const patchRule = useCallback(
    async (id: number, patch: Partial<Pick<RoutingRule, 'priority' | 'enabled'>>): Promise<void> => {
      try {
        const res = await fetch(`/api/providers/routing/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await fetchRules()
      } catch {
        showFeedback(false, 'Failed to update rule.')
      }
    },
    [fetchRules, showFeedback],
  )

  const deleteRule = useCallback(
    async (id: number): Promise<void> => {
      try {
        const res = await fetch(`/api/providers/routing/${id}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        showFeedback(true, 'Provider removed.')
        await fetchRules()
      } catch {
        showFeedback(false, 'Failed to delete rule.')
      }
    },
    [fetchRules, showFeedback],
  )

  const shiftPriority = useCallback(
    (rule: RoutingRule, direction: 'up' | 'down'): void => {
      // Swap priorities with adjacent rule to reorder
      const sorted = [...rules].sort((a, b) => a.priority - b.priority)
      const idx = sorted.findIndex((r) => r.id === rule.id)
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= sorted.length) return

      const sibling = sorted[swapIdx]
      patchRule(rule.id, { priority: sibling.priority })
      patchRule(sibling.id, { priority: rule.priority })
    },
    [rules, patchRule],
  )

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-auto">
      {feedback && (
        <div
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            feedback.ok
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Routing Rules</h2>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Cancel' : '+ Add Provider'}
          </Button>
        </div>

        {showAddForm && (
          <AddProviderForm
            form={addForm}
            submitting={submitting}
            onChange={setAddForm}
            onSubmit={handleAddSubmit}
            onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM) }}
          />
        )}

        {rulesLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Loading routing rules…
          </div>
        )}
        {rulesError && !rulesLoading && (
          <div className="text-sm text-red-400 py-4">{rulesError}</div>
        )}
        {!rulesLoading && !rulesError && (
          <RoutingTable
            rules={rules}
            onToggle={(rule) => patchRule(rule.id, { enabled: rule.enabled ? 0 : 1 })}
            onDelete={deleteRule}
            onShift={shiftPriority}
          />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Health Monitor</h2>

        {healthLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Loading health data…
          </div>
        )}
        {healthError && !healthLoading && (
          <div className="text-sm text-red-400 py-4">{healthError}</div>
        )}
        {!healthLoading && !healthError && health.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No health data yet. Health checks will appear as the system routes requests.
          </p>
        )}
        {!healthLoading && !healthError && health.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.map((h) => (
              <HealthCard key={h.provider} health={h} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
