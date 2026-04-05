'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { HandoffChainParsed, HandoffStep } from '@/app/api/handoff-chains/route'
import type { HandoffChainRunWithName } from '@/app/api/handoff-chains/runs/route'

// ─── Local types ────────────────────────────────────────────────────────────

type View = 'list' | 'builder'

interface BuilderStep {
  agentName: string
  promptTemplate: string
  label: string
}

const EMPTY_STEP: BuilderStep = { agentName: '', promptTemplate: '', label: '' }

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const styles: Record<string, string> = {
    draft: 'bg-secondary text-muted-foreground',
    active: 'bg-green-500/20 text-green-400',
    archived: 'bg-amber-500/20 text-amber-400',
    running: 'bg-amber-500/20 text-amber-400 animate-pulse',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${styles[status] ?? 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

// ─── Step editor card ─────────────────────────────────────────────────────────

interface StepCardProps {
  step: BuilderStep
  index: number
  total: number
  onChange: (index: number, field: keyof BuilderStep, value: string) => void
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
}

function StepCard({ step, index, total, onChange, onMove, onRemove }: StepCardProps): React.JSX.Element {
  return (
    <div className="p-2.5 rounded-lg border border-border bg-secondary/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-muted-foreground">Step {index + 1}</span>
        <div className="flex gap-1">
          <Button onClick={() => onMove(index, -1)} disabled={index === 0} variant="ghost" size="icon-xs" title="Move up">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path d="M8 3v10M4 7l4-4 4 4" />
            </svg>
          </Button>
          <Button onClick={() => onMove(index, 1)} disabled={index === total - 1} variant="ghost" size="icon-xs" title="Move down">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path d="M8 13V3M4 9l4 4 4-4" />
            </svg>
          </Button>
          <Button onClick={() => onRemove(index)} variant="ghost" size="icon-xs" className="text-red-400 hover:text-red-300" title="Remove step">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>
      <input
        value={step.label}
        onChange={e => onChange(index, 'label', e.target.value)}
        placeholder="Label (e.g. Step 1)"
        className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60"
      />
      <input
        value={step.agentName}
        onChange={e => onChange(index, 'agentName', e.target.value)}
        placeholder="Agent name (e.g. CFO)"
        className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60"
      />
      <textarea
        value={step.promptTemplate}
        onChange={e => onChange(index, 'promptTemplate', e.target.value)}
        placeholder="Prompt template — use {{input}} for the previous step's output"
        rows={2}
        className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/60 resize-none"
      />
    </div>
  )
}

// ─── Chain builder view ───────────────────────────────────────────────────────

interface BuilderViewProps {
  editing: HandoffChainParsed | null
  onSaved: () => void
  onCancel: () => void
}

function BuilderView({ editing, onSaved, onCancel }: BuilderViewProps): React.JSX.Element {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [steps, setSteps] = useState<BuilderStep[]>(
    editing
      ? editing.steps.map(s => ({ agentName: s.agentName, promptTemplate: s.promptTemplate, label: s.label }))
      : [{ ...EMPTY_STEP }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValid = name.trim().length > 0 && steps.length >= 1

  const addStep = (): void => setSteps(s => [...s, { ...EMPTY_STEP }])

  const removeStep = (index: number): void =>
    setSteps(s => s.filter((_, i) => i !== index))

  const moveStep = (index: number, dir: -1 | 1): void => {
    setSteps(s => {
      const arr = [...s]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      return arr.map((item, i) => {
        if (i === index) return arr[target]
        if (i === target) return arr[index]
        return item
      })
    })
  }

  const handleStepChange = (index: number, field: keyof BuilderStep, value: string): void => {
    setSteps(s => s.map((step, i) => i === index ? { ...step, [field]: value } : step))
  }

  const handleSave = async (): Promise<void> => {
    if (!isValid) return
    setSaving(true)
    setError(null)

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      steps: steps.map(s => ({
        agentName: s.agentName.trim(),
        promptTemplate: s.promptTemplate.trim(),
        label: s.label.trim(),
      } satisfies HandoffStep)),
    }

    try {
      const url = editing ? `/api/handoff-chains/${editing.id}` : '/api/handoff-chains'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Save failed')
        return
      }
      onSaved()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {editing ? 'Edit Chain' : 'New Chain'}
        </span>
        <Button onClick={onCancel} variant="ghost" size="xs">Cancel</Button>
      </div>

      {error && (
        <div className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">{error}</div>
      )}

      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Chain name (required)"
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/60"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/60"
      />

      <div className="space-y-2">
        <span className="text-2xs text-muted-foreground">Steps ({steps.length})</span>
        {steps.map((step, i) => (
          <StepCard
            key={i}
            step={step}
            index={i}
            total={steps.length}
            onChange={handleStepChange}
            onMove={moveStep}
            onRemove={removeStep}
          />
        ))}
        <Button onClick={addStep} variant="secondary" size="xs" className="w-full">
          + Add Step
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!isValid || saving} size="xs">
          {saving ? 'Saving…' : editing ? 'Update Chain' : 'Create Chain'}
        </Button>
      </div>
    </div>
  )
}

// ─── Chain list view ─────────────────────────────────────────────────────────

interface ListViewProps {
  onNew: () => void
  onEdit: (chain: HandoffChainParsed) => void
}

function ListView({ onNew, onEdit }: ListViewProps): React.JSX.Element {
  const [chains, setChains] = useState<HandoffChainParsed[]>([])
  const [runs, setRuns] = useState<HandoffChainRunWithName[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<number | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchChains = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/handoff-chains', { signal: AbortSignal.timeout(8000) }),
        fetch('/api/handoff-chains/runs?limit=5', { signal: AbortSignal.timeout(8000) }),
      ])
      const cData = await cRes.json() as { success?: boolean; data?: HandoffChainParsed[]; error?: string }
      const rData = await rRes.json() as { success?: boolean; data?: HandoffChainRunWithName[]; error?: string }

      if (!cRes.ok) { setError(cData.error ?? 'Failed to load chains'); return }
      setChains(cData.data ?? [])
      setRuns(rData.data ?? [])
    } catch {
      setError('Network error — could not load handoff chains')
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 30s; initial fetch fires on mount
  useSmartPoll(fetchChains, 30_000)

  const showToast = (ok: boolean, text: string): void => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 3000)
  }

  const handleRun = async (chain: HandoffChainParsed): Promise<void> => {
    // Prompt for optional input data
    const inputData = window.prompt(`Input data for "${chain.name}" (leave blank if none)`)
    if (inputData === null) return // user cancelled

    setRunning(chain.id)
    try {
      const res = await fetch(`/api/handoff-chains/${chain.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_data: inputData || null }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json() as { success?: boolean; data?: { id: number }; error?: string }
      if (res.ok) {
        showToast(true, `Run #${data.data?.id ?? '?'} started`)
        void fetchChains()
      } else {
        showToast(false, data.error ?? 'Failed to start run')
      }
    } catch {
      showToast(false, 'Network error')
    } finally {
      setRunning(null)
    }
  }

  const handleDelete = async (chain: HandoffChainParsed): Promise<void> => {
    if (!window.confirm(`Delete chain "${chain.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/handoff-chains/${chain.id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        showToast(true, 'Chain deleted')
        void fetchChains()
      } else {
        const data = await res.json() as { error?: string }
        showToast(false, data.error ?? 'Delete failed')
      }
    } catch {
      showToast(false, 'Network error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <span className="animate-pulse">Loading handoff chains…</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs px-2 py-1.5 rounded bg-red-500/10 text-red-400">{error}</div>
      )}

      {toast && (
        <div className={`text-xs px-2 py-1 rounded ${toast.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {toast.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{chains.length} chain{chains.length !== 1 ? 's' : ''}</span>
        <Button onClick={onNew} variant="link" size="xs">New Chain</Button>
      </div>

      {chains.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-1">No handoff chains yet</p>
          <p className="text-xs text-muted-foreground">Create a chain to compose sequential multi-agent workflows</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chains.map(chain => (
            <ChainCard
              key={chain.id}
              chain={chain}
              running={running === chain.id}
              onRun={handleRun}
              onEdit={onEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <RecentRunsSection runs={runs} />
    </div>
  )
}

// ─── Chain card ───────────────────────────────────────────────────────────────

interface ChainCardProps {
  chain: HandoffChainParsed
  running: boolean
  onRun: (chain: HandoffChainParsed) => void
  onEdit: (chain: HandoffChainParsed) => void
  onDelete: (chain: HandoffChainParsed) => void
}

function ChainCard({ chain, running, onRun, onEdit, onDelete }: ChainCardProps): React.JSX.Element {
  return (
    <div className="bg-card border border-border rounded-lg p-3 group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{chain.name}</span>
            <StatusBadge status={chain.status} />
            <span className="text-2xs text-muted-foreground">{chain.steps.length} step{chain.steps.length !== 1 ? 's' : ''}</span>
          </div>
          {chain.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{chain.description}</p>
          )}
          {chain.steps.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
              {chain.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-1 shrink-0">
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground whitespace-nowrap">
                    {step.label || step.agentName || `Step ${i + 1}`}
                  </span>
                  {i < chain.steps.length - 1 && (
                    <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                      <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <Button onClick={() => onRun(chain)} disabled={running} size="xs">
            {running ? '…' : 'Run'}
          </Button>
          <Button onClick={() => onEdit(chain)} variant="secondary" size="icon-xs" title="Edit">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button onClick={() => onDelete(chain)} variant="destructive" size="icon-xs" title="Delete">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Recent runs section ─────────────────────────────────────────────────────

function RecentRunsSection({ runs }: { runs: HandoffChainRunWithName[] }): React.JSX.Element {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">Recent Runs</span>
      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-1">No runs yet</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          {runs.map(run => (
            <div key={run.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/30 text-xs">
              <StatusBadge status={run.status} />
              <span className="text-muted-foreground truncate flex-1">
                {run.chain_name ?? `Chain #${run.chain_id}`} — Run #{run.id}
              </span>
              <span className="text-muted-foreground/70 shrink-0">
                {new Date(run.started_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Root panel export ────────────────────────────────────────────────────────

export function HandoffChainsPanel(): React.JSX.Element {
  const [view, setView] = useState<View>('list')
  const [editingChain, setEditingChain] = useState<HandoffChainParsed | null>(null)
  const [listKey, setListKey] = useState(0)

  const handleNew = (): void => {
    setEditingChain(null)
    setView('builder')
  }

  const handleEdit = (chain: HandoffChainParsed): void => {
    setEditingChain(chain)
    setView('builder')
  }

  const handleSaved = (): void => {
    // Re-mount the list view to trigger a fresh fetch
    setListKey(k => k + 1)
    setView('list')
    setEditingChain(null)
  }

  const handleCancel = (): void => {
    setView('list')
    setEditingChain(null)
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-primary shrink-0">
          <path d="M4 10h12M10 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold text-foreground">Handoff Chains</span>
      </div>

      {view === 'list' && (
        <ListView key={listKey} onNew={handleNew} onEdit={handleEdit} />
      )}

      {view === 'builder' && (
        <BuilderView
          editing={editingChain}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}
