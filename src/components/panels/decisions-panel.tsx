'use client'

import { useState, useEffect, useCallback } from 'react'

interface Decision {
  id: number
  workspace_id: number
  task_id: number | null
  decision: string
  rationale: string
  why_not: string
  owner: string
  revisit_by: number
  confidence: 'high' | 'medium' | 'low'
  status: 'active' | 'superseded' | 'archived'
  scope: 'task' | 'strategic' | 'operational'
  category: string | null
  tags: string[]
  source: string | null
  created_at: number
  updated_at: number
}

const SCOPE_TABS = [
  { key: 'strategic', label: 'Strategic' },
  { key: 'operational', label: 'Operational' },
  { key: 'task', label: 'Task-scoped' },
  { key: 'all', label: 'All' },
] as const

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-500/20 text-blue-400',
  superseded: 'bg-orange-500/20 text-orange-400',
  archived: 'bg-gray-500/20 text-gray-400',
}

export function DecisionsPanel() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scopeTab, setScopeTab] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [total, setTotal] = useState(0)

  const fetchDecisions = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (scopeTab !== 'all') params.set('scope', scopeTab)
      if (statusFilter) params.set('status', statusFilter)
      params.set('limit', '100')
      const res = await fetch(`/api/decisions?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setDecisions(data.decisions)
      setTotal(data.total)
      setError('')
    } catch {
      setError('Failed to load decisions')
    } finally {
      setLoading(false)
    }
  }, [scopeTab, statusFilter])

  useEffect(() => { fetchDecisions() }, [fetchDecisions])

  const filtered = search
    ? decisions.filter((d) =>
        d.decision.toLowerCase().includes(search.toLowerCase()) ||
        d.rationale.toLowerCase().includes(search.toLowerCase())
      )
    : decisions

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Decisions</h1>
          <p className="text-sm text-muted-foreground">{total} decision records</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Add Decision
        </button>
      </div>

      {/* Scope tabs */}
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setScopeTab(tab.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              scopeTab === tab.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search decisions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="active">Active</option>
          <option value="superseded">Superseded</option>
          <option value="archived">Archived</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No decisions found
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((d) => (
            <DecisionCard key={d.id} decision={d} onRefresh={fetchDecisions} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDecisionModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchDecisions() }}
          defaultScope={scopeTab !== 'all' ? scopeTab : 'strategic'}
        />
      )}
    </div>
  )
}

function DecisionCard({ decision: d, onRefresh }: { decision: Decision; onRefresh: () => void }) {
  const revisitDate = new Date(d.revisit_by * 1000)
  const isOverdue = d.revisit_by < Date.now() / 1000 && d.status === 'active'

  return (
    <div className="p-4 bg-card border border-border rounded-xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{d.decision}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${CONFIDENCE_COLORS[d.confidence]}`}>
            {d.confidence}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[d.status]}`}>
            {d.status}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><span className="text-foreground/60">Rationale:</span> {d.rationale}</p>
        {d.why_not && <p><span className="text-foreground/60">Why not:</span> {d.why_not}</p>}
      </div>

      <div className="flex items-center flex-wrap gap-2 text-xs">
        <span className="px-2 py-0.5 bg-secondary rounded text-muted-foreground">{d.scope}</span>
        {d.category && (
          <span className="px-2 py-0.5 bg-secondary rounded text-muted-foreground">{d.category}</span>
        )}
        {d.tags.map((tag) => (
          <span key={tag} className="px-2 py-0.5 bg-primary/10 text-primary rounded">{tag}</span>
        ))}
        <span className="text-muted-foreground">by {d.owner}</span>
        <span className={`text-muted-foreground ${isOverdue ? 'text-red-400' : ''}`}>
          revisit {revisitDate.toLocaleDateString()}
        </span>
        {d.source && <span className="text-muted-foreground">via {d.source}</span>}
      </div>
    </div>
  )
}

function CreateDecisionModal({
  onClose,
  onCreated,
  defaultScope,
}: {
  onClose: () => void
  onCreated: () => void
  defaultScope: string
}) {
  const [form, setForm] = useState({
    decision: '',
    rationale: '',
    why_not: '',
    owner: '',
    revisit_by: '',
    confidence: 'medium',
    scope: defaultScope,
    category: '',
    tags: '',
    source: '',
    task_id: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const revisitDate = new Date(form.revisit_by)
      if (isNaN(revisitDate.getTime())) {
        setError('Invalid revisit date')
        setSubmitting(false)
        return
      }

      const body: any = {
        decision: form.decision,
        rationale: form.rationale,
        why_not: form.why_not || '',
        owner: form.owner,
        revisit_by: Math.floor(revisitDate.getTime() / 1000),
        confidence: form.confidence,
        scope: form.scope,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      }
      if (form.category) body.category = form.category
      if (form.source) body.source = form.source
      if (form.task_id) body.task_id = parseInt(form.task_id)

      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create')
      }

      onCreated()
    } catch (err: any) {
      setError(err.message || 'Failed to create decision')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass = 'w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-card border border-border rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Add Decision</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Decision *</label>
            <textarea
              required
              rows={2}
              value={form.decision}
              onChange={(e) => setForm({ ...form, decision: e.target.value })}
              className={fieldClass}
              placeholder="What was decided?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Rationale *</label>
            <textarea
              required
              rows={2}
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              className={fieldClass}
              placeholder="Why this decision?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Why not (alternatives)</label>
            <textarea
              rows={2}
              value={form.why_not}
              onChange={(e) => setForm({ ...form, why_not: e.target.value })}
              className={fieldClass}
              placeholder="What alternatives were considered?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Owner *</label>
              <input
                required
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className={fieldClass}
                placeholder="Who made this?"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Revisit by *</label>
              <input
                required
                type="date"
                value={form.revisit_by}
                onChange={(e) => setForm({ ...form, revisit_by: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Confidence</label>
              <select
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
                className={fieldClass}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                className={fieldClass}
              >
                <option value="strategic">Strategic</option>
                <option value="operational">Operational</option>
                <option value="task">Task</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={fieldClass}
                placeholder="e.g. architecture"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className={fieldClass}
                placeholder="tag1, tag2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Source</label>
              <input
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className={fieldClass}
                placeholder="e.g. standup, retro"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Task ID (optional)</label>
            <input
              type="number"
              value={form.task_id}
              onChange={(e) => setForm({ ...form, task_id: e.target.value })}
              className={fieldClass}
              placeholder="Link to task"
            />
          </div>

          {error && (
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Decision'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
