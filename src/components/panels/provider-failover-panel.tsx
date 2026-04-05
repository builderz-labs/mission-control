'use client'

import { useState, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Button } from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoutingRule {
  id: number
  provider: string
  priority: number
  enabled: number
  max_retries: number
  timeout_ms: number
  capability_tags: string[]
  workspace_id: number
  created_at: number
  updated_at: number
}

interface RecentLog {
  id: number
  latency_ms: number | null
  status: string
  error: string | null
  checked_at: number
}

interface ProviderHealth {
  provider: string
  avgLatency: number | null
  p95Latency: number | null
  successRate: number
  lastError: string | null
  lastChecked: number | null
  recentLogs: RecentLog[]
}

interface AddForm {
  provider: string
  priority: string
  max_retries: string
  timeout_ms: string
  capability_tags: string
}

const EMPTY_FORM: AddForm = {
  provider: '',
  priority: '',
  max_retries: '2',
  timeout_ms: '30000',
  capability_tags: '',
}

// ── Main component ────────────────────────────────────────────────────────────

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

  // ── Data fetchers ───────────────────────────────────────────────────────────

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

  // ── Actions ─────────────────────────────────────────────────────────────────

  const showFeedback = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }, [])

  const handleAddSubmit = useCallback(async () => {
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
    async (id: number, patch: Partial<Pick<RoutingRule, 'priority' | 'enabled'>>) => {
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
    async (id: number) => {
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
    (rule: RoutingRule, direction: 'up' | 'down') => {
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-auto">
      {/* Feedback toast */}
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

      {/* ── Routing Rules ───────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Routing Rules</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Cancel' : '+ Add Provider'}
          </Button>
        </div>

        {/* Inline add form */}
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

      {/* ── Health Monitor ──────────────────────────────────────────────────── */}
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

// ── Sub-components ────────────────────────────────────────────────────────────

interface AddProviderFormProps {
  form: AddForm
  submitting: boolean
  onChange: (form: AddForm) => void
  onSubmit: () => void
  onCancel: () => void
}

function AddProviderForm({ form, submitting, onChange, onSubmit, onCancel }: AddProviderFormProps): React.JSX.Element {
  const set = (key: keyof AddForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value })

  return (
    <div className="mb-4 rounded-lg border border-border bg-card/50 p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3">
        Common providers: anthropic, openai, cohere
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Provider *</label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="e.g. anthropic"
            value={form.provider}
            onChange={set('provider')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="auto"
            value={form.priority}
            onChange={set('priority')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Max Retries</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.max_retries}
            onChange={set('max_retries')}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Timeout (ms)</label>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.timeout_ms}
            onChange={set('timeout_ms')}
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1 block">
          Capability Tags (comma-separated)
        </label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. vision, function-calling"
          value={form.capability_tags}
          onChange={set('capability_tags')}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={submitting || !form.provider.trim()}>
          {submitting ? 'Adding…' : 'Add Provider'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface RoutingTableProps {
  rules: RoutingRule[]
  onToggle: (rule: RoutingRule) => void
  onDelete: (id: number) => void
  onShift: (rule: RoutingRule, direction: 'up' | 'down') => void
}

function RoutingTable({ rules, onToggle, onDelete, onShift }: RoutingTableProps): React.JSX.Element {
  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        No providers configured yet. Add anthropic, openai, or cohere to get started.
      </div>
    )
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {['Provider', 'Priority', 'Status', 'Max Retries', 'Timeout', 'Tags', 'Actions'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((rule, idx) => (
            <tr key={rule.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 font-medium capitalize">{rule.provider}</td>
              <td className="px-3 py-2 text-muted-foreground">{rule.priority}</td>
              <td className="px-3 py-2">
                <button
                  onClick={() => onToggle(rule)}
                  className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                    rule.enabled ? 'bg-green-500' : 'bg-muted'
                  }`}
                  aria-label={rule.enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{rule.max_retries}</td>
              <td className="px-3 py-2 text-muted-foreground">{rule.timeout_ms.toLocaleString()}ms</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {rule.capability_tags.length === 0 ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    rule.capability_tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onShift(rule, 'up')}
                    disabled={idx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                    aria-label="Increase priority"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => onShift(rule, 'down')}
                    disabled={idx === sorted.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                    aria-label="Decrease priority"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => onDelete(rule.id)}
                    className="ml-1 text-red-400 hover:text-red-300 px-1 text-xs"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface HealthCardProps {
  health: ProviderHealth
}

function HealthCard({ health }: HealthCardProps): React.JSX.Element {
  // Status dot color: green >90%, amber 70-90%, red <70%
  const dotColor =
    health.successRate > 90
      ? 'bg-green-500'
      : health.successRate >= 70
        ? 'bg-amber-500'
        : 'bg-red-500'

  const lastChecked = health.lastChecked
    ? new Date(health.lastChecked * 1000).toLocaleTimeString()
    : 'never'

  const truncatedError =
    health.lastError && health.lastError.length > 80
      ? `${health.lastError.slice(0, 80)}…`
      : health.lastError

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="font-medium capitalize text-sm">{health.provider}</span>
        </div>
        {health.avgLatency !== null && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {health.avgLatency}ms avg
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-2">Last checked: {lastChecked}</p>

      {/* Success rate progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Success rate</span>
          <span className={health.successRate > 90 ? 'text-green-400' : health.successRate >= 70 ? 'text-amber-400' : 'text-red-400'}>
            {health.successRate}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              health.successRate > 90
                ? 'bg-green-500'
                : health.successRate >= 70
                  ? 'bg-amber-500'
                  : 'bg-red-500'
            }`}
            style={{ width: `${health.successRate}%` }}
          />
        </div>
      </div>

      {truncatedError && (
        <p className="text-xs text-red-400 truncate" title={health.lastError ?? ''}>
          {truncatedError}
        </p>
      )}
    </div>
  )
}
