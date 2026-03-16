'use client'

import { useCallback, useEffect, useState } from 'react'

// ── Types ──

interface ScalingPolicy {
  id: number
  name: string
  min_agents: number
  max_agents: number
  scale_up_threshold: number
  scale_down_threshold: number
  cooldown_seconds: number
  idle_timeout_seconds: number
  auto_approve: number
  agent_template: string | null
  enabled: number
  workspace_id: number
  created_at: number
  updated_at: number
}

interface ScalingEvent {
  id: number
  policy_id: number | null
  event_type: string
  agent_id: number | null
  status: string
  reason: string
  metrics_snapshot: string | null
  workspace_id: number
  created_at: number
  resolved_at: number | null
}

interface WorkloadMetrics {
  queueDepth: number
  activeAgents: number
  idleAgents: number
  busyAgents: number
  busyRatio: number
}

// ── Helpers ──

function eventStatusBadge(status: string): string {
  switch (status) {
    case 'pending': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    case 'approved': case 'completed': return 'text-green-400 bg-green-500/10 border-green-500/30'
    case 'rejected': return 'text-red-400 bg-red-500/10 border-red-500/30'
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
  }
}

function formatTime(epoch: number | null): string {
  if (!epoch) return '-'
  return new Date(epoch * 1000).toLocaleString()
}

// ── Pool Overview ──

function PoolOverview({ metrics }: { metrics: WorkloadMetrics | null }) {
  if (!metrics) {
    return <div className="p-4 text-sm text-muted-foreground">Loading metrics...</div>
  }

  const { queueDepth, activeAgents, idleAgents, busyAgents, busyRatio } = metrics
  const total = activeAgents

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Queue Depth</div>
        <div className="text-2xl font-bold">{queueDepth}</div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Active Agents</div>
        <div className="text-2xl font-bold">{total}</div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Busy</div>
        <div className="text-2xl font-bold text-blue-400">{busyAgents}</div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Idle</div>
        <div className="text-2xl font-bold text-green-400">{idleAgents}</div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Busy Ratio</div>
        <div className="text-2xl font-bold">{(busyRatio * 100).toFixed(0)}%</div>
      </div>
    </div>
  )
}

// ── Policy Form ──

function PolicyForm({
  onCreated,
  editPolicy,
  onCancel,
}: {
  onCreated: () => void
  editPolicy?: ScalingPolicy | null
  onCancel?: () => void
}) {
  const [name, setName] = useState(editPolicy?.name ?? '')
  const [minAgents, setMinAgents] = useState(editPolicy?.min_agents ?? 0)
  const [maxAgents, setMaxAgents] = useState(editPolicy?.max_agents ?? 10)
  const [scaleUpThreshold, setScaleUpThreshold] = useState(editPolicy?.scale_up_threshold ?? 0.8)
  const [scaleDownThreshold, setScaleDownThreshold] = useState(editPolicy?.scale_down_threshold ?? 0.2)
  const [cooldownSeconds, setCooldownSeconds] = useState(editPolicy?.cooldown_seconds ?? 300)
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(editPolicy?.idle_timeout_seconds ?? 600)
  const [autoApprove, setAutoApprove] = useState(editPolicy?.auto_approve === 1)
  const [agentTemplate, setAgentTemplate] = useState(editPolicy?.agent_template ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body = {
        name,
        min_agents: minAgents,
        max_agents: maxAgents,
        scale_up_threshold: scaleUpThreshold,
        scale_down_threshold: scaleDownThreshold,
        cooldown_seconds: cooldownSeconds,
        idle_timeout_seconds: idleTimeoutSeconds,
        auto_approve: autoApprove,
        agent_template: agentTemplate || null,
      }
      const url = editPolicy
        ? `/api/scaling/policies/${editPolicy.id}`
        : '/api/scaling/policies'
      const res = await fetch(url, {
        method: editPolicy ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save policy')
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border border-border rounded-lg bg-card">
      <h3 className="font-medium text-sm">{editPolicy ? 'Edit Policy' : 'New Scaling Policy'}</h3>
      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm"
            required
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Agent Template</span>
          <input
            type="text"
            value={agentTemplate}
            onChange={(e) => setAgentTemplate(e.target.value)}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="optional"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Min Agents</span>
          <input type="number" value={minAgents} onChange={(e) => setMinAgents(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={0} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Max Agents</span>
          <input type="number" value={maxAgents} onChange={(e) => setMaxAgents(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={1} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Scale Up Threshold</span>
          <input type="number" value={scaleUpThreshold} onChange={(e) => setScaleUpThreshold(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={0} max={1} step={0.1} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Scale Down Threshold</span>
          <input type="number" value={scaleDownThreshold} onChange={(e) => setScaleDownThreshold(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={0} max={1} step={0.1} />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Cooldown (s)</span>
          <input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={0} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Idle Timeout (s)</span>
          <input type="number" value={idleTimeoutSeconds} onChange={(e) => setIdleTimeoutSeconds(Number(e.target.value))}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" min={0} />
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          <span className="text-xs text-muted-foreground">Auto-approve</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : editPolicy ? 'Update' : 'Create'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-3 py-1 text-sm rounded border border-border hover:bg-accent">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

// ── Policies Tab ──

function PoliciesTab() {
  const [policies, setPolicies] = useState<ScalingPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPolicy, setEditPolicy] = useState<ScalingPolicy | null>(null)
  const [evaluating, setEvaluating] = useState<number | null>(null)
  const [evalResult, setEvalResult] = useState<string | null>(null)

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch('/api/scaling/policies')
      if (!res.ok) return
      const data = await res.json()
      setPolicies(data.policies ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this scaling policy?')) return
    await fetch(`/api/scaling/policies/${id}`, { method: 'DELETE' })
    fetchPolicies()
  }

  const handleToggle = async (policy: ScalingPolicy) => {
    await fetch(`/api/scaling/policies/${policy.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: policy.enabled ? 0 : 1 }),
    })
    fetchPolicies()
  }

  const handleEvaluate = async (policyId: number) => {
    setEvaluating(policyId)
    setEvalResult(null)
    try {
      const res = await fetch('/api/scaling/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId }),
      })
      const data = await res.json()
      if (data.event) {
        setEvalResult(`Event created: ${data.event.event_type} — ${data.event.reason}`)
      } else {
        setEvalResult(data.message || 'No action needed')
      }
    } catch {
      setEvalResult('Evaluation failed')
    } finally {
      setEvaluating(null)
    }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading policies...</div>

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Scaling Policies ({policies.length})</h3>
        <button
          onClick={() => { setShowForm(!showForm); setEditPolicy(null) }}
          className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:opacity-90"
        >
          {showForm ? 'Cancel' : '+ New Policy'}
        </button>
      </div>

      {evalResult && (
        <div className="text-sm p-2 rounded border border-border bg-card">{evalResult}</div>
      )}

      {(showForm || editPolicy) && (
        <PolicyForm
          editPolicy={editPolicy}
          onCreated={() => { setShowForm(false); setEditPolicy(null); fetchPolicies() }}
          onCancel={() => { setShowForm(false); setEditPolicy(null) }}
        />
      )}

      {policies.length === 0 ? (
        <div className="text-sm text-muted-foreground">No scaling policies configured.</div>
      ) : (
        <div className="space-y-2">
          {policies.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <button
                onClick={() => handleToggle(p)}
                className={`w-8 h-4 rounded-full relative transition-colors ${p.enabled ? 'bg-green-500' : 'bg-gray-500'}`}
                title={p.enabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)'}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${p.enabled ? 'right-0.5' : 'left-0.5'}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  Agents: {p.min_agents}-{p.max_agents} | Up: {p.scale_up_threshold} | Down: {p.scale_down_threshold} | Cooldown: {p.cooldown_seconds}s
                  {p.auto_approve ? ' | Auto' : ''}
                  {p.agent_template ? ` | Template: ${p.agent_template}` : ''}
                </div>
              </div>
              <button
                onClick={() => handleEvaluate(p.id)}
                disabled={evaluating === p.id || !p.enabled}
                className="px-2 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
              >
                {evaluating === p.id ? '...' : 'Evaluate'}
              </button>
              <button
                onClick={() => { setEditPolicy(p); setShowForm(false) }}
                className="px-2 py-1 text-xs rounded border border-border hover:bg-accent"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Del
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Events Tab ──

function EventsTab() {
  const [events, setEvents] = useState<ScalingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/scaling/events')
      if (!res.ok) return
      const data = await res.json()
      setEvents(data.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const handleAction = async (eventId: number, action: 'approve' | 'reject') => {
    await fetch(`/api/scaling/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    fetchEvents()
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading events...</div>

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Scaling Events ({events.length})</h3>
        <button
          onClick={fetchEvents}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent"
        >
          Refresh
        </button>
      </div>

      {events.length === 0 ? (
        <div className="text-sm text-muted-foreground">No scaling events recorded.</div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-lg border border-border bg-card">
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
              >
                <span className={`px-2 py-0.5 text-xs rounded border ${eventStatusBadge(ev.status)}`}>
                  {ev.status}
                </span>
                <span className="text-xs font-medium">
                  {ev.event_type === 'scale_up' ? '[+] Scale Up' : '[-] Scale Down'}
                </span>
                <span className="text-xs text-muted-foreground flex-1 truncate">{ev.reason}</span>
                <span className="text-xs text-muted-foreground">{formatTime(ev.created_at)}</span>
                {ev.status === 'pending' && (
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(ev.id, 'approve') }}
                      className="px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    >
                      Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(ev.id, 'reject') }}
                      className="px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
              {expandedId === ev.id && ev.metrics_snapshot && (
                <div className="px-3 pb-3 border-t border-border pt-2">
                  <div className="text-xs text-muted-foreground">Metrics Snapshot</div>
                  <pre className="text-xs mt-1 p-2 rounded bg-background overflow-x-auto">
                    {JSON.stringify(JSON.parse(ev.metrics_snapshot), null, 2)}
                  </pre>
                  {ev.agent_id && (
                    <div className="text-xs mt-1 text-muted-foreground">Agent ID: {ev.agent_id}</div>
                  )}
                  {ev.resolved_at && (
                    <div className="text-xs mt-1 text-muted-foreground">Resolved: {formatTime(ev.resolved_at)}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ──

export function ScalingPanel() {
  const [activeTab, setActiveTab] = useState<'overview' | 'policies' | 'events'>('overview')
  const [metrics, setMetrics] = useState<WorkloadMetrics | null>(null)

  useEffect(() => {
    async function loadMetrics() {
      try {
        const res = await fetch('/api/workload')
        if (!res.ok) return
        const data = await res.json()
        setMetrics({
          queueDepth: data.metrics?.queueDepth ?? data.queueDepth ?? 0,
          activeAgents: data.metrics?.activeAgents ?? data.activeAgents ?? 0,
          idleAgents: data.metrics?.idleAgents ?? data.idleAgents ?? 0,
          busyAgents: data.metrics?.busyAgents ?? data.busyAgents ?? 0,
          busyRatio: data.metrics?.busyRatio ?? data.busyRatio ?? 0,
        })
      } catch { /* ignore */ }
    }
    loadMetrics()
    const interval = setInterval(loadMetrics, 10000)
    return () => clearInterval(interval)
  }, [])

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'policies' as const, label: 'Policies' },
    { id: 'events' as const, label: 'Events' },
  ]

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Auto-Scaling Monitor</h2>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <PoolOverview metrics={metrics} />}
      {activeTab === 'policies' && <PoliciesTab />}
      {activeTab === 'events' && <EventsTab />}
    </div>
  )
}
