'use client'

import { useState, useEffect, useCallback } from 'react'

interface AlertRule {
  id: number
  name: string
  description: string | null
  enabled: number
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  action_type: string
  action_config: string
  cooldown_minutes: number
  last_triggered_at: number | null
  trigger_count: number
  created_by: string
  created_at: number
  updated_at: number
}

interface EvalResult {
  rule_id: number
  rule_name: string
  triggered: boolean
  reason?: string
}

const ENTITY_FIELDS: Record<string, string[]> = {
  agent: ['status', 'role', 'name', 'last_seen', 'last_activity'],
  task: ['status', 'priority', 'assigned_to', 'title'],
  session: ['status'],
  activity: ['type', 'actor', 'entity_type'],
}

const OPERATORS = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '!=' },
  { value: 'greater_than', label: '>' },
  { value: 'less_than', label: '<' },
  { value: 'contains', label: 'contains' },
  { value: 'count_above', label: 'count >' },
  { value: 'count_below', label: 'count <' },
  { value: 'age_minutes_above', label: 'age (min) >' },
]

const ENTITY_COLORS: Record<string, string> = {
  agent: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  task: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  session: 'bg-green-500/20 text-green-400 border-green-500/30',
  activity: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}

export function AlertRulesPanel() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [evalResults, setEvalResults] = useState<EvalResult[] | null>(null)
  const [evaluating, setEvaluating] = useState(false)

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts')
      const data = await res.json()
      setRules(data.rules || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  const toggleRule = async (rule: AlertRule) => {
    await fetch('/api/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, enabled: rule.enabled ? 0 : 1 }),
    })
    fetchRules()
  }

  const deleteRule = async (id: number) => {
    await fetch('/api/alerts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchRules()
  }

  const evaluateAll = async () => {
    setEvaluating(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate' }),
      })
      const data = await res.json()
      setEvalResults(data.results || [])
    } catch { /* ignore */ }
    setEvaluating(false)
    fetchRules() // refresh trigger counts
  }

  const enabledCount = rules.filter(r => r.enabled).length
  const totalTriggers = rules.reduce((sum, r) => sum + r.trigger_count, 0)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Alert Rules</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure automated alerts for agent, task, and system events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={evaluateAll}
            disabled={evaluating || rules.length === 0}
            className="h-8 px-3 rounded-md text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-smooth disabled:opacity-50 flex items-center gap-1.5"
          >
            {evaluating ? (
              <>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                Evaluating...
              </>
            ) : (
              <>
                <PlayIcon />
                Evaluate Now
              </>
            )}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth"
          >
            + New Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-2xs text-muted-foreground">Total Rules</div>
          <div className="text-xl font-bold text-foreground mt-0.5">{rules.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-2xs text-muted-foreground">Active</div>
          <div className="text-xl font-bold text-green-400 mt-0.5">{enabledCount}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-2xs text-muted-foreground">Total Triggers</div>
          <div className="text-xl font-bold text-amber-400 mt-0.5">{totalTriggers}</div>
        </div>
      </div>

      {/* Eval Results */}
      {evalResults && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Evaluation Results</h3>
            <button onClick={() => setEvalResults(null)} className="text-xs text-muted-foreground hover:text-foreground">
              Dismiss
            </button>
          </div>
          <div className="space-y-1.5">
            {evalResults.map(r => (
              <div key={r.rule_id} className={`flex items-center justify-between py-1.5 px-3 rounded-md text-xs ${
                r.triggered ? 'bg-red-500/10 border border-red-500/20' : 'bg-secondary/50'
              }`}>
                <span className="font-medium text-foreground">{r.rule_name}</span>
                <span className={r.triggered ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
                  {r.triggered ? 'TRIGGERED' : r.reason}
                </span>
              </div>
            ))}
            {evalResults.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-2">No rules to evaluate</div>
            )}
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <CreateRuleForm onCreated={() => { fetchRules(); setShowCreate(false) }} onCancel={() => setShowCreate(false)} />
      )}

      {/* Rules List */}
      {loading ? (
        <div className="text-center text-xs text-muted-foreground py-8">Loading rules...</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <div className="text-3xl mb-2 opacity-30">&#9888;</div>
          <p className="text-sm text-muted-foreground">No alert rules configured</p>
          <p className="text-xs text-muted-foreground mt-1">Create a rule to get notified about system events</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => (
            <RuleCard key={rule.id} rule={rule} onToggle={() => toggleRule(rule)} onDelete={() => deleteRule(rule.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function RuleCard({ rule, onToggle, onDelete }: { rule: AlertRule; onToggle: () => void; onDelete: () => void }) {
  const operator = OPERATORS.find(o => o.value === rule.condition_operator)
  const lastTriggered = rule.last_triggered_at
    ? new Date(rule.last_triggered_at * 1000).toLocaleString()
    : 'Never'

  return (
    <div className={`bg-card border rounded-lg p-4 transition-smooth ${
      rule.enabled ? 'border-border' : 'border-border/50 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-2xs px-1.5 py-0.5 rounded border ${ENTITY_COLORS[rule.entity_type] || 'bg-muted text-muted-foreground border-border'}`}>
              {rule.entity_type}
            </span>
            <h3 className="text-sm font-semibold text-foreground truncate">{rule.name}</h3>
          </div>
          {rule.description && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{rule.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-2xs text-muted-foreground flex-wrap">
            <span className="font-mono bg-secondary/50 px-1.5 py-0.5 rounded">
              {rule.condition_field} {operator?.label || rule.condition_operator} {rule.condition_value}
            </span>
            <span>Cooldown: {rule.cooldown_minutes}m</span>
            <span>Triggered: {rule.trigger_count}x</span>
            <span>Last: {lastTriggered}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggle}
            className={`w-10 h-5 rounded-full transition-smooth relative ${
              rule.enabled ? 'bg-green-500' : 'bg-muted'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
              rule.enabled ? 'left-5.5 right-0.5' : 'left-0.5'
            }`} style={{ left: rule.enabled ? '22px' : '2px' }} />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-smooth flex items-center justify-center"
            title="Delete rule"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateRuleForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    entity_type: 'agent',
    condition_field: 'status',
    condition_operator: 'equals',
    condition_value: '',
    cooldown_minutes: 60,
    recipient: 'system',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fields = ENTITY_FIELDS[form.entity_type] || []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          entity_type: form.entity_type,
          condition_field: form.condition_field,
          condition_operator: form.condition_operator,
          condition_value: form.condition_value,
          cooldown_minutes: form.cooldown_minutes,
          action_type: 'notification',
          action_config: { recipient: form.recipient },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create rule')
        return
      }
      onCreated()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/20 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">New Alert Rule</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Rule Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Agent Offline Alert"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Optional description"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Entity</label>
          <select
            value={form.entity_type}
            onChange={e => setForm({ ...form, entity_type: e.target.value, condition_field: ENTITY_FIELDS[e.target.value]?.[0] || 'status' })}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="agent">Agent</option>
            <option value="task">Task</option>
            <option value="session">Session</option>
            <option value="activity">Activity</option>
          </select>
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Field</label>
          <select
            value={form.condition_field}
            onChange={e => setForm({ ...form, condition_field: e.target.value })}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {fields.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Operator</label>
          <select
            value={form.condition_operator}
            onChange={e => setForm({ ...form, condition_operator: e.target.value })}
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Value</label>
          <input
            type="text"
            value={form.condition_value}
            onChange={e => setForm({ ...form, condition_value: e.target.value })}
            placeholder="e.g., error"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Cooldown (minutes)</label>
          <input
            type="number"
            value={form.cooldown_minutes}
            onChange={e => setForm({ ...form, cooldown_minutes: parseInt(e.target.value) || 60 })}
            min={1}
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-2xs text-muted-foreground mb-1">Notify (recipient)</label>
          <input
            type="text"
            value={form.recipient}
            onChange={e => setForm({ ...form, recipient: e.target.value })}
            placeholder="system"
            className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-4 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-smooth"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Rule'}
        </button>
      </div>
    </form>
  )
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  )
}
