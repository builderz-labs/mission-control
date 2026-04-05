'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { WorkflowTemplate, PipelineStep, Pipeline, PipelineRun } from './pipeline-types'
import { ActiveRunCard } from './active-run-card'
import { PipelineForm } from './pipeline-form'
import { PipelineListItem } from './pipeline-list-item'

export function PipelineTab(): React.JSX.Element {
  const t = useTranslations('pipeline')
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [formMode, setFormMode] = useState<'hidden' | 'create' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formSteps, setFormSteps] = useState<PipelineStep[]>([])

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [spawning, setSpawning] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true)
    setFetchError(null)
    try {
      const [tRes, pRes, rRes] = await Promise.all([
        fetch('/api/workflows', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
        fetch('/api/pipelines', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
        fetch('/api/pipelines/run?limit=10', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      ])
      setTemplates(tRes.templates || [])
      setPipelines(pRes.pipelines || [])
      setRuns(rRes.runs || [])
    } catch {
      setFetchError('Failed to load pipeline data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-dismiss result banner after 3s
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 3000)
    return () => clearTimeout(timer)
  }, [result])

  const closeForm = (): void => {
    setFormMode('hidden')
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormSteps([])
  }

  const addStep = (templateId: number): void => {
    const tmpl = templates.find(t => t.id === templateId)
    if (!tmpl) return
    setFormSteps(s => [...s, { template_id: templateId, template_name: tmpl.name, on_failure: 'stop' }])
  }

  const removeStep = (index: number): void => {
    setFormSteps(s => s.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, dir: -1 | 1): void => {
    setFormSteps(s => {
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

  const updateStepFailure = (index: number, value: 'stop' | 'continue'): void => {
    setFormSteps(s => s.map((st, i) => i === index ? { ...st, on_failure: value } : st))
  }

  const savePipeline = async (): Promise<void> => {
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
        signal: AbortSignal.timeout(8000),
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

  const startEdit = (p: Pipeline): void => {
    setFormMode('edit')
    setEditingId(p.id)
    setFormName(p.name)
    setFormDesc(p.description || '')
    setFormSteps(p.steps)
  }

  const deletePipeline = async (id: number): Promise<void> => {
    await fetch(`/api/pipelines?id=${id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
    if (expandedId === id) setExpandedId(null)
    fetchData()
  }

  const runPipeline = async (id: number): Promise<void> => {
    setSpawning(id)
    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', pipeline_id: id }),
        signal: AbortSignal.timeout(8000),
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

  const advanceRun = async (runId: number, success: boolean): Promise<void> => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance', run_id: runId, success }),
        signal: AbortSignal.timeout(8000),
      })
      fetchData()
    } catch { /* network errors silently ignored — UI will reflect on next fetchData */ }
  }

  const cancelRun = async (runId: number): Promise<void> => {
    try {
      await fetch('/api/pipelines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', run_id: runId }),
        signal: AbortSignal.timeout(8000),
      })
      fetchData()
    } catch { /* network errors silently ignored — UI will reflect on next fetchData */ }
  }

  const activeRuns = runs.filter(r => r.status === 'running')

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <span className="animate-pulse">Loading pipelines...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {fetchError && <div className="text-xs text-red-400 px-4 py-2">{fetchError}</div>}
      {result && (
        <div className={`text-xs px-2 py-1 rounded ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {result.text}
        </div>
      )}

      {activeRuns.length > 0 && (
        <div className="space-y-2">
          {activeRuns.map(run => (
            <ActiveRunCard key={run.id} run={run} onAdvance={advanceRun} onCancel={cancelRun} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('pipelineCount', { count: pipelines.length })}</span>
        <Button
          onClick={() => formMode !== 'hidden' ? closeForm() : setFormMode('create')}
          variant="link"
          size="xs"
        >
          {formMode !== 'hidden' ? t('cancel') : t('newPipeline')}
        </Button>
      </div>

      {formMode !== 'hidden' && (
        <PipelineForm
          formMode={formMode as 'create' | 'edit'}
          formName={formName}
          formDesc={formDesc}
          formSteps={formSteps}
          templates={templates}
          onNameChange={setFormName}
          onDescChange={setFormDesc}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onMoveStep={moveStep}
          onFailureChange={updateStepFailure}
          onSave={savePipeline}
        />
      )}

      {pipelines.length === 0 && formMode === 'hidden' ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">{t('noPipelines')}</p>
          <p className="text-xs text-muted-foreground">{t('noPipelinesHint')}</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pipelines.map(p => (
            <PipelineListItem
              key={p.id}
              pipeline={p}
              runs={runs}
              expandedId={expandedId}
              spawning={spawning}
              onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
              onRun={runPipeline}
              onEdit={startEdit}
              onDelete={deletePipeline}
              onAdvance={advanceRun}
              onCancel={cancelRun}
            />
          ))}
        </div>
      )}
    </div>
  )
}
