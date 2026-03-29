'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

// ── Types ──────────────────────────────────────────────────────────────────

interface GatewayInfo {
  status: 'connected' | 'unknown' | 'error'
  activeSessionCount: number
  totalSessionCount: number
}

interface SessionSummary {
  id: string
  agent: string
  model: string
  tokens: number
  contextSize: number
  tokenUsagePct: number
  age: number
  ageLabel: string
  active: boolean
  channel: string
}

interface ModelPingResult {
  provider: string
  model: string
  status: 'up' | 'down' | 'degraded'
  latencyMs: number
  checkedAt: number
  error?: string
}

interface WaterfallStep {
  id: number
  waterfall_id: number
  step_order: number
  provider: string
  model: string
}

interface Waterfall {
  id: number
  name: string
  agent_id: number | null
  created_at: number
  steps: WaterfallStep[]
}

interface SessionLimit {
  id: number
  session_key: string
  max_tokens: number
  alert_threshold: number
}

interface DashboardData {
  gateway: GatewayInfo
  sessions: SessionSummary[]
  modelHealth: ModelPingResult[]
  waterfalls: Waterfall[]
  sessionLimits: SessionLimit[]
  compactionCandidates: string[]
  fetchedAt: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function statusDot(status: 'up' | 'down' | 'degraded' | 'connected' | 'unknown' | 'error') {
  const cls: Record<string, string> = {
    up: 'bg-green-500',
    connected: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
    error: 'bg-red-500',
    unknown: 'bg-muted-foreground/40',
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${cls[status] ?? 'bg-muted-foreground/40'}`}
      title={status}
    />
  )
}

function TokenBar({ pct, threshold }: { pct: number; threshold?: number }) {
  const color =
    pct >= (threshold ?? 80) ? 'bg-red-500' :
    pct >= 60 ? 'bg-amber-500' :
    'bg-void-cyan'
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

// ── Health Strip ───────────────────────────────────────────────────────────

function HealthStrip({ gateway, sessions, fetchedAt }: {
  gateway: GatewayInfo
  sessions: SessionSummary[]
  fetchedAt: number
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Gateway Health</span>
        <span className="text-xs text-muted-foreground">
          Updated {relativeTime(fetchedAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-muted/40 border border-border text-xs">
          {statusDot(gateway.status)}
          <span className="font-medium">Gateway</span>
          <span className="text-muted-foreground capitalize">{gateway.status}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-muted/40 border border-border text-xs">
          <span className="text-2xl font-mono font-bold tabular-nums leading-none text-foreground">
            {gateway.activeSessionCount}
          </span>
          <div className="text-muted-foreground">
            <div>active</div>
            <div>{gateway.totalSessionCount} total</div>
          </div>
        </div>
        {sessions.filter(s => s.active).slice(0, 4).map(s => (
          <div key={s.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-muted/40 border border-border text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-mono truncate max-w-[100px]">{s.agent}</span>
            <span className="text-muted-foreground">{s.tokenUsagePct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Model Status Table ─────────────────────────────────────────────────────

function ModelStatusTable({ modelHealth }: { modelHealth: ModelPingResult[] }) {
  if (modelHealth.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Model Health</h2>
          <p className="text-xs text-muted-foreground">No models configured yet. Set them up in the Models panel.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Model Health</h2>
        <p className="text-xs text-muted-foreground">{modelHealth.length} models tracked</p>
      </div>
      <div className="divide-y divide-border">
        {/* Header */}
        <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider px-4 py-2">
          <span className="w-4 mr-2 shrink-0" />
          <span className="flex-1">Model</span>
          <span className="w-24 text-center">Provider</span>
          <span className="w-20 text-center">Latency</span>
          <span className="w-24 text-right">Checked</span>
        </div>
        {modelHealth.map((m, i) => (
          <div key={`${m.provider}:${m.model}:${i}`} className="flex items-center px-4 py-2.5 hover:bg-muted/20 text-xs">
            <span className="w-4 mr-2 shrink-0">{statusDot(m.status)}</span>
            <span className="flex-1 font-mono text-sm truncate">{m.model}</span>
            <span className="w-24 text-center text-muted-foreground">{m.provider}</span>
            <span className="w-20 text-center font-mono">
              {m.status === 'up' || m.status === 'degraded' ? (
                <span className={m.latencyMs > 2000 ? 'text-amber-400' : 'text-green-400'}>
                  {m.latencyMs}ms
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </span>
            <span className="w-24 text-right text-muted-foreground">
              {m.checkedAt ? relativeTime(m.checkedAt) : 'never'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Fallback Chain Viewer ──────────────────────────────────────────────────

interface FallbackViewerProps {
  waterfalls: Waterfall[]
  isOperator: boolean
  onDelete: (id: number) => Promise<void>
  onAdd: (name: string, steps: Array<{ provider: string; model: string }>) => Promise<void>
  saving: boolean
}

function FallbackChainViewer({ waterfalls, isOperator, onDelete, onAdd, saving }: FallbackViewerProps) {
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSteps, setNewSteps] = useState<Array<{ provider: string; model: string }>>([
    { provider: '', model: '' },
  ])

  function handleAddStep() {
    setNewSteps(prev => [...prev, { provider: '', model: '' }])
  }

  function handleRemoveStep(i: number) {
    setNewSteps(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleStepChange(i: number, field: 'provider' | 'model', value: string) {
    setNewSteps(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validSteps = newSteps.filter(s => s.provider.trim() && s.model.trim())
    if (!newName.trim() || validSteps.length === 0) return
    await onAdd(newName.trim(), validSteps)
    setNewName('')
    setNewSteps([{ provider: '', model: '' }])
    setShowForm(false)
  }

  const fieldCls = 'px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50'

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold">Fallback Chains</h2>
          <p className="text-xs text-muted-foreground">Per-agent model waterfall configurations</p>
        </div>
        {isOperator && !showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>+ New</Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-4 space-y-3 bg-muted/10 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Waterfall</h3>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Waterfall name (e.g. coding-agent-chain)"
            className={`${fieldCls} w-full`}
            required
          />
          <div className="space-y-1.5">
            {newSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono w-4 text-center shrink-0">{i + 1}</span>
                <input
                  value={step.provider}
                  onChange={e => handleStepChange(i, 'provider', e.target.value)}
                  placeholder="provider"
                  className={`${fieldCls} flex-1`}
                />
                <input
                  value={step.model}
                  onChange={e => handleStepChange(i, 'model', e.target.value)}
                  placeholder="model alias"
                  className={`${fieldCls} flex-1`}
                />
                {newSteps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveStep(i)}
                    className="text-red-400 hover:text-red-300 text-xs w-5 h-5 flex items-center justify-center shrink-0"
                  >×</button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleAddStep}>+ Step</Button>
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || !newName.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      )}

      <div className="divide-y divide-border">
        {waterfalls.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No fallback chains configured.
            {isOperator && !showForm && (
              <> <button onClick={() => setShowForm(true)} className="text-primary hover:underline">Create one</button>.</>
            )}
          </div>
        ) : (
          waterfalls.map(wf => (
            <div key={wf.id} className="px-4 py-3 group hover:bg-muted/20">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold truncate">{wf.name}</span>
                    {wf.agent_id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                        agent:{wf.agent_id}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {wf.steps.map((step, i) => (
                      <div key={step.id} className="flex items-center gap-1 text-xs">
                        {i > 0 && <span className="text-muted-foreground/40">→</span>}
                        <span className="px-2 py-0.5 rounded bg-muted/50 border border-border font-mono">
                          {step.provider}/{step.model}
                        </span>
                      </div>
                    ))}
                    {wf.steps.length === 0 && (
                      <span className="text-xs text-muted-foreground/50 italic">no steps</span>
                    )}
                  </div>
                </div>
                {isOperator && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(wf.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Session List ───────────────────────────────────────────────────────────

function SessionList({ sessions, compactionCandidates, sessionLimits }: {
  sessions: SessionSummary[]
  compactionCandidates: string[]
  sessionLimits: SessionLimit[]
}) {
  const limitMap = new Map(sessionLimits.map(l => [l.session_key, l]))

  if (sessions.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Active Sessions</h2>
        </div>
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No sessions tracked. Connect a gateway or start an agent.
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold">Active Sessions</h2>
          <p className="text-xs text-muted-foreground">{sessions.length} tracked</p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider px-4 py-2 border-b border-border">
        <span className="w-4 mr-2 shrink-0" />
        <span className="flex-1 min-w-0">Agent / Session</span>
        <span className="w-28 text-center hidden sm:block">Model</span>
        <span className="w-20 text-center">Usage</span>
        <span className="w-12 text-center">Age</span>
        <span className="w-20 text-center hidden md:block">Channel</span>
        <span className="w-16 text-right">Flags</span>
      </div>

      <div className="divide-y divide-border">
        {sessions.map(session => {
          const limit = limitMap.get(session.id)
          const threshold = limit?.alert_threshold ?? 80
          const isNearLimit = session.tokenUsagePct >= threshold
          const needsCompaction = compactionCandidates.includes(session.id)

          return (
            <div
              key={session.id}
              className={`flex items-center px-4 py-2.5 hover:bg-muted/20 text-xs ${
                needsCompaction ? 'border-l-2 border-amber-500/70' : ''
              }`}
            >
              {/* Status dot */}
              <span className="w-4 mr-2 shrink-0">
                {session.active ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
                )}
              </span>

              {/* Agent / Session ID */}
              <div className="flex-1 min-w-0 pr-2">
                <div className="font-medium text-sm truncate">{session.agent}</div>
                <div className="text-muted-foreground/60 font-mono text-[10px] truncate">{session.id}</div>
                {/* Usage bar */}
                <div className="mt-1 w-full">
                  <TokenBar pct={session.tokenUsagePct} threshold={threshold} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>{(session.tokens / 1000).toFixed(0)}k / {(session.contextSize / 1000).toFixed(0)}k</span>
                  <span className={isNearLimit ? 'text-amber-400 font-semibold' : ''}>
                    {session.tokenUsagePct}%
                  </span>
                </div>
              </div>

              {/* Model */}
              <span className="w-28 text-center font-mono text-muted-foreground hidden sm:block truncate px-1">
                {session.model}
              </span>

              {/* Usage % badge */}
              <span className="w-20 text-center">
                <span className={`text-xs tabular-nums font-mono ${
                  session.tokenUsagePct >= 90 ? 'text-red-400' :
                  session.tokenUsagePct >= 70 ? 'text-amber-400' : 'text-muted-foreground'
                }`}>
                  {session.tokenUsagePct}%
                </span>
              </span>

              {/* Age */}
              <span className="w-12 text-center text-muted-foreground font-mono">
                {session.ageLabel}
              </span>

              {/* Channel */}
              <span className="w-20 text-center text-muted-foreground hidden md:block truncate px-1">
                {session.channel}
              </span>

              {/* Flags */}
              <div className="w-16 text-right flex items-center justify-end gap-1 flex-wrap">
                {needsCompaction && (
                  <span
                    className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold"
                    title="Context near limit — compaction recommended"
                  >
                    PRUNE
                  </span>
                )}
                {!session.active && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-muted-foreground/10 text-muted-foreground/50">
                    IDLE
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Compaction Summary ─────────────────────────────────────────────────────

function CompactionStrip({ compactionCandidates, sessions }: {
  compactionCandidates: string[]
  sessions: SessionSummary[]
}) {
  if (compactionCandidates.length === 0) return null
  const candidateSessions = sessions.filter(s => compactionCandidates.includes(s.id))

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-amber-400 shrink-0 mt-0.5">
          <path d="M8 2L2 14h12L8 2z" />
          <path d="M8 7v3M8 12v0.5" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-400">
            {compactionCandidates.length} session{compactionCandidates.length !== 1 ? 's' : ''} near context limit
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            These sessions are consuming ≥80% of their context window and may need compaction or pruning.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {candidateSessions.map(s => (
              <div key={s.id} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs">
                <span className="font-medium">{s.agent}</span>
                <span className="text-amber-400 font-mono font-semibold">{s.tokenUsagePct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export function SessionDashboardPanel() {
  const { currentUser } = useMissionControl()
  const isOperator = currentUser?.role === 'operator' || currentUser?.role === 'admin'

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showFeedback(ok: boolean, text: string) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ ok, text })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
  }

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/session-dashboard')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || `HTTP ${res.status}`)
        return
      }
      const d: DashboardData = await res.json()
      setData(d)
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load session dashboard')
    }
  }, [])

  // Poll every 30s; pause when hidden
  useSmartPoll(fetchData, 30_000)

  // ── Waterfall CRUD ──────────────────────────────────────────────────────

  const handleDeleteWaterfall = useCallback(async (id: number) => {
    if (!confirm('Delete this waterfall?')) return
    setSaving(true)
    try {
      const res = await fetch('/api/session-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-waterfall', id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showFeedback(false, err.error || 'Delete failed')
      } else {
        showFeedback(true, 'Waterfall deleted')
        await fetchData()
      }
    } catch (e: any) {
      showFeedback(false, e.message || 'Delete failed')
    } finally {
      setSaving(false)
    }
  }, [fetchData])

  const handleAddWaterfall = useCallback(async (
    name: string,
    steps: Array<{ provider: string; model: string }>
  ) => {
    setSaving(true)
    try {
      const res = await fetch('/api/session-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-waterfall', name, steps }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showFeedback(false, err.error || 'Create failed')
      } else {
        showFeedback(true, 'Waterfall created')
        await fetchData()
      }
    } catch (e: any) {
      showFeedback(false, e.message || 'Create failed')
    } finally {
      setSaving(false)
    }
  }, [fetchData])

  // ── Render ──────────────────────────────────────────────────────────────

  if (!data) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        {error ? (
          <div className="space-y-2">
            <p className="text-red-400">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchData}>Retry</Button>
          </div>
        ) : (
          <>
            <span className="inline-block w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
            Loading session dashboard...
          </>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Session Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gateway health · model status · active sessions · fallback chains
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          ↺ Refresh
        </Button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`px-3 py-2 rounded text-sm border ${
            feedback.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Top health strip */}
      <HealthStrip
        gateway={data.gateway}
        sessions={data.sessions}
        fetchedAt={data.fetchedAt}
      />

      {/* Compaction alerts */}
      {data.compactionCandidates.length > 0 && (
        <CompactionStrip
          compactionCandidates={data.compactionCandidates}
          sessions={data.sessions}
        />
      )}

      {/* Model status table */}
      <ModelStatusTable modelHealth={data.modelHealth} />

      {/* Session list */}
      <SessionList
        sessions={data.sessions}
        compactionCandidates={data.compactionCandidates}
        sessionLimits={data.sessionLimits}
      />

      {/* Fallback chain viewer */}
      <FallbackChainViewer
        waterfalls={data.waterfalls}
        isOperator={isOperator}
        onDelete={handleDeleteWaterfall}
        onAdd={handleAddWaterfall}
        saving={saving}
      />
    </div>
  )
}
