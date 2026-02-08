'use client'

import { useState, useEffect, useCallback } from 'react'

interface WorkflowTemplate {
  id: number
  name: string
  model: string
}

interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: PipelineStep[]
  use_count: number
  last_used_at: number | null
  runs: { total: number; completed: number; failed: number; running: number }
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
}

interface PipelineRun {
  id: number
  pipeline_id: number
  pipeline_name?: string
  status: string
  current_step: number
  steps_snapshot: RunStepState[]
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}

export function PipelineTab() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])

  // Form state
  const [formMode, setFormMode] = useState<'hidden' | 'create' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formSteps, setFormSteps] = useState<PipelineStep[]>([])

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [spawning, setSpawning] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchData = useCallback(async () => {
    const [tRes, pRes, rRes] = await Promise.all([
      fetch('/api/workflows').then(r => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/pipelines').then(r => r.json()).catch(() => ({ pipelines: [] })),
      fetch('/api/pipelines/run?limit=10').then(r => r.json()).catch(() => ({ runs: [] })),
    ])
    setTemplates(tRes.templates || [])
    setPipelines(pRes.pipelines || [])
    setRuns(rRes.runs || [])
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Clear result after 3s
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 3000)
    return () => clearTimeout(timer)
  }, [result])

  const closeForm = () => {
    setFormMode('hidden')
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormSteps([])
  }

  const addStep = (templateId: number) => {
    const t = templates.find(t => t.id === templateId)
    if (!t) return
    setFormSteps(s => [...s, { template_id: templateId, template_name: t.name, on_failure: 'stop' }])
  }

  const removeStep = (index: number) => {
    setFormSteps(s => s.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, dir: -1 | 1) => {
    setFormSteps(s => {
      const arr = [...s]
      const target = index + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[index], arr[target]] = [arr[target], arr[index]]
      return arr
    })
  }

  const savePipeline = async () => {
    if (!formName || formSteps.length < 2) return
    try {
      const payload = {
        ...(formMode === 'edit' ? { id: editingId } : {}),
        name: formName,
        description: formDesc || null,
        steps: formSteps.map(s => ({ template_id: s.template_id, on_failure: s.on_failure })),
      }
      const res = await fetch('/api/pipelines', {
        method: formMode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        closeForm()
        fetchData()
        setResult({ ok: true, text: formMode === 'edit' ? 'Pipeline updated' : 'Pipeline created' })
      } else {
        const data = await res.json()
        setResult({ ok: false, text: data.error || 'Failed' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    }
  }

  const startEdit = (p: Pipeline) => {
    setFormMode('edit')
    setEditingId(p.id)
    setFormName(p.name)
    setFormDesc(p.description || '')
    setFormSteps(p.steps)
  }

  const deletePipeline = async (id: number) => {
    await fetch(`/api/pipelines?id=${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  const runPipeline = async (id: number) => {
    setSpawning(id)
    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', pipeline_id: id }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, text: `Pipeline started (run #${data.run?.id})` })
        fetchData()
      } else {
        setResult({ ok: false, text: data.error || 'Failed to start' })
      }
    } catch {
      setResult({ ok: false, text: 'Network error' })
    } finally {
      setSpawning(null)
    }
  }

  const advanceRun = async (runId: number, success: boolean) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance', run_id: runId, success }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  const cancelRun = async (runId: number) => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
      })
      fetchData()
    } catch { /* ignore */ }
  }

  // Active runs (running pipelines shown at top)
  const activeRuns = runs.filter(r => r.status === 'running')

  return (
    <div className="space-y-3">
      {/* Result message */}
      {result && (
        <div className={`text-xs px-2 py-1 rounded ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.text}
        </div>
      )}

      {/* Active runs banner */}
      {activeRuns.length > 0 && (
        <div className="space-y-2">
          {activeRuns.map(run => (
            <ActiveRunCard key={run.id} run={run} onAdvance={advanceRun} onCancel={cancelRun} />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{pipelines.length} pipelines</span>
        <button
          onClick={() => formMode !== 'hidden' ? closeForm() : setFormMode('create')}
          className="text-xs text-primary hover:underline"
        >
          {formMode !== 'hidden' ? 'Cancel' : '+ New Pipeline'}
        </button>
      </div>

      {/* Create/Edit form */}
      {formMode !== 'hidden' && (
        <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
          <span className="text-xs font-medium">{formMode === 'edit' ? 'Edit Pipeline' : 'New Pipeline'}</span>
          <input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="Pipeline name"
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-sm text-foreground"
          />

          {/* Step builder */}
          <div className="space-y-1">
            <span className="text-2xs text-muted-foreground">Steps ({formSteps.length})</span>
            {formSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5 p-1.5 rounded bg-secondary/80 text-xs">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-2xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-foreground">{step.template_name || `Template #${step.template_id}`}</span>
                <select
                  value={step.on_failure}
                  onChange={e => setFormSteps(s => s.map((st, idx) => idx === i ? { ...st, on_failure: e.target.value as 'stop' | 'continue' } : st))}
                  className="h-5 px-1 text-2xs rounded bg-secondary border border-border text-foreground"
                >
                  <option value="stop">Stop on fail</option>
                  <option value="continue">Continue on fail</option>
                </select>
                <button onClick={() => moveStep(i, -1)} className="text-muted-foreground hover:text-foreground" title="Move up">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 3v10M4 7l4-4 4 4" /></svg>
                </button>
                <button onClick={() => moveStep(i, 1)} className="text-muted-foreground hover:text-foreground" title="Move down">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M8 13V3M4 9l4 4 4-4" /></svg>
                </button>
                <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-300">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                </button>
              </div>
            ))}

            {/* Add step dropdown */}
            <select
              onChange={e => { if (e.target.value) { addStep(parseInt(e.target.value)); e.target.value = '' } }}
              className="w-full h-7 px-2 rounded-md bg-secondary border border-border text-xs text-muted-foreground"
              defaultValue=""
            >
              <option value="" disabled>+ Add workflow template as step...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.model})</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <button
              onClick={savePipeline}
              disabled={!formName || formSteps.length < 2}
              className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {formMode === 'edit' ? 'Update' : 'Save Pipeline'}
            </button>
          </div>
        </div>
      )}

      {/* Pipeline list */}
      {pipelines.length === 0 && formMode === 'hidden' ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">No pipelines yet</p>
          <p className="text-xs text-muted-foreground">Create a pipeline to chain workflow templates together</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pipelines.map(p => (
            <div key={p.id} className="rounded-md bg-secondary/30 hover:bg-secondary/50 transition-smooth group">
              <div className="flex items-center gap-2 p-2">
                <button
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    <span className="text-2xs text-muted-foreground">{p.steps.length} steps</span>
                    {p.use_count > 0 && <span className="text-2xs text-muted-foreground">{p.use_count}x</span>}
                    {p.runs.running > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">running</span>
                    )}
                  </div>
                  {/* Mini step visualization */}
                  <div className="flex items-center gap-0.5 mt-1">
                    {p.steps.map((s, i) => (
                      <div key={i} className="flex items-center gap-0.5">
                        <span className="text-2xs px-1 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[80px]">
                          {s.template_name}
                        </span>
                        {i < p.steps.length - 1 && (
                          <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0">
                            <path d="M2 4h4M5 2l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </button>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                  <button
                    onClick={() => runPipeline(p.id)}
                    disabled={spawning === p.id}
                    className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                  >
                    {spawning === p.id ? '...' : 'Run'}
                  </button>
                  <button onClick={() => startEdit(p)} className="h-7 px-1.5 rounded-md bg-secondary text-foreground text-xs hover:bg-secondary/80" title="Edit">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M11.5 1.5l3 3-9 9H2.5v-3z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button onClick={() => deletePipeline(p.id)} className="h-7 px-1.5 rounded-md bg-destructive/20 text-destructive text-xs hover:bg-destructive/30" title="Delete">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expanded: pipeline visualization + recent runs */}
              {expandedId === p.id && (
                <div className="px-3 pb-3 border-t border-border/50 mt-1 pt-2 space-y-3">
                  {/* Full pipeline visualization */}
                  <PipelineViz steps={p.steps} />

                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

                  {/* Recent runs for this pipeline */}
                  <div>
                    <span className="text-2xs text-muted-foreground">
                      Runs: {p.runs.total} total, {p.runs.completed} completed, {p.runs.failed} failed
                    </span>
                    {runs.filter(r => r.pipeline_id === p.id).slice(0, 3).map(run => (
                      <div key={run.id} className="mt-1 p-2 rounded bg-secondary/50 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">Run #{run.id}</span>
                          <RunStatusBadge status={run.status} />
                        </div>
                        <RunStepsViz steps={run.steps_snapshot} />
                        {run.status === 'running' && (
                          <div className="flex gap-1 mt-1.5">
                            <button onClick={() => advanceRun(run.id, true)} className="h-6 px-2 rounded bg-green-500/20 text-green-400 text-2xs hover:bg-green-500/30">
                              Mark Step Done
                            </button>
                            <button onClick={() => advanceRun(run.id, false)} className="h-6 px-2 rounded bg-red-500/20 text-red-400 text-2xs hover:bg-red-500/30">
                              Mark Step Failed
                            </button>
                            <button onClick={() => cancelRun(run.id)} className="h-6 px-2 rounded bg-secondary text-muted-foreground text-2xs hover:bg-secondary/80">
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Full step visualization with boxes and arrows */
function PipelineViz({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-0.5">
            <div className="px-2 py-1.5 rounded-md border border-border bg-secondary text-xs font-medium text-foreground whitespace-nowrap">
              {s.template_name || `Step ${i + 1}`}
            </div>
            {s.on_failure === 'continue' && (
              <span className="text-2xs text-amber-400">continue on fail</span>
            )}
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 20 12" fill="none" className="w-5 h-3 text-muted-foreground/60 shrink-0">
              <path d="M0 6h16M13 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

/** Run steps visualization with colored status dots */
function RunStepsViz({ steps }: { steps: RunStepState[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              s.status === 'completed' ? 'bg-green-500' :
              s.status === 'running' ? 'bg-amber-500 animate-pulse' :
              s.status === 'failed' ? 'bg-red-500' :
              s.status === 'skipped' ? 'bg-gray-500' : 'bg-gray-600'
            }`} />
            <span className={`text-2xs whitespace-nowrap ${
              s.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'
            }`}>
              {s.template_name}
            </span>
          </div>
          {i < steps.length - 1 && (
            <svg viewBox="0 0 8 8" className="w-2 h-2 text-muted-foreground/40 shrink-0">
              <path d="M1 4h6M5 2l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'bg-amber-500/20 text-amber-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${styles[status] || 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

/** Active run card shown at top of pipeline tab */
function ActiveRunCard({ run, onAdvance, onCancel }: {
  run: PipelineRun
  onAdvance: (id: number, success: boolean) => void
  onCancel: (id: number) => void
}) {
  return (
    <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {run.pipeline_name || `Pipeline #${run.pipeline_id}`} — Run #{run.id}
          </span>
        </div>
        <span className="text-2xs text-muted-foreground">
          Step {run.current_step + 1}/{run.steps_snapshot.length}
        </span>
      </div>
      <RunStepsViz steps={run.steps_snapshot} />
      <div className="flex gap-1 mt-2">
        <button onClick={() => onAdvance(run.id, true)} className="h-6 px-2 rounded bg-green-500/20 text-green-400 text-2xs hover:bg-green-500/30">
          Step Done
        </button>
        <button onClick={() => onAdvance(run.id, false)} className="h-6 px-2 rounded bg-red-500/20 text-red-400 text-2xs hover:bg-red-500/30">
          Step Failed
        </button>
        <button onClick={() => onCancel(run.id)} className="h-6 px-2 rounded bg-secondary text-muted-foreground text-2xs hover:bg-secondary/80 ml-auto">
          Cancel
        </button>
      </div>
    </div>
  )
}
