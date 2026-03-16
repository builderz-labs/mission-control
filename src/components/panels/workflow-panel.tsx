'use client'

import { useCallback, useEffect, useState } from 'react'
// Panel uses same-origin cookie auth — no API key needed

// ── Types ──

interface WorkflowPhase {
  id: number
  name: string
  phase_order: number
  agent_role: string | null
  requires_approval: boolean
  description: string | null
  input_schema: unknown
  output_schema: unknown
}

interface WorkflowTemplate {
  id: number
  name: string
  description: string | null
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string | null
  tags: string[]
  phases: WorkflowPhase[]
  use_count: number
  created_at: number
  updated_at: number
}

interface PhaseRunStatus {
  id: number
  run_id: number
  phase_id: number
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'rejected'
  phase_name: string
  phase_order: number
  input_artifact: unknown
  output_artifact: unknown
  validation_error: string | null
  approved_by: string | null
  approved_at: number | null
  started_at: number | null
  completed_at: number | null
}

interface WorkflowRun {
  id: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  current_phase_id: number | null
  input_data: unknown
  started_at: number | null
  completed_at: number | null
  created_by: string
  created_at: number
}

interface RunDetail {
  run: WorkflowRun
  phases: PhaseRunStatus[]
}

// ── Helpers ──

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-blue-500'
    case 'completed': return 'bg-green-500'
    case 'failed': case 'rejected': return 'bg-red-500'
    case 'paused': return 'bg-yellow-500'
    default: return 'bg-gray-400'
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'running': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    case 'completed': return 'text-green-400 bg-green-500/10 border-green-500/30'
    case 'failed': case 'rejected': return 'text-red-400 bg-red-500/10 border-red-500/30'
    case 'paused': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
  }
}

function formatTime(epoch: number | null): string {
  if (!epoch) return '-'
  return new Date(epoch * 1000).toLocaleString()
}

// ── Phase Progress Bar ──

function PhaseProgressBar({ phases }: { phases: PhaseRunStatus[] }) {
  return (
    <div className="flex gap-1 items-center w-full">
      {phases.map((p) => (
        <div key={p.id} className="flex-1 flex flex-col items-center gap-1">
          <div
            className={`h-2 w-full rounded-full ${statusColor(p.status)}`}
            title={`${p.phase_name}: ${p.status}`}
          />
          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
            {p.phase_name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Workflow Run Detail ──

function WorkflowRunDetail({
  runId,
  onBack,
}: {
  runId: number
  onBack: () => void
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`, {

      })
      if (!res.ok) throw new Error('Failed to fetch run')
      const data = await res.json()
      setDetail(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const handleApprove = async (phaseRunId: number) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_run_id: phaseRunId }),
      })
      if (!res.ok) throw new Error('Failed to approve')
      await fetchDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async (phaseRunId: number) => {
    const reason = prompt('Rejection reason:')
    if (!reason) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_run_id: phaseRunId, reason }),
      })
      if (!res.ok) throw new Error('Failed to reject')
      await fetchDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading run detail...</div>
  if (error) return <div className="p-4 text-sm text-red-400">{error}</div>
  if (!detail) return null

  const { run, phases } = detail

  return (
    <div className="flex flex-col gap-4 p-4">
      <button onClick={onBack} className="text-xs text-blue-400 hover:underline self-start">
        Back to Runs
      </button>

      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{run.template_name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(run.status)}`}>
          {run.status}
        </span>
      </div>

      <div className="text-xs text-muted-foreground">
        Run #{run.id} | Started by {run.created_by} | {formatTime(run.started_at)}
        {run.completed_at && <> | Completed {formatTime(run.completed_at)}</>}
      </div>

      <PhaseProgressBar phases={phases} />

      <div className="flex flex-col gap-2 mt-2">
        {phases.map((p) => (
          <div
            key={p.id}
            className="border border-border rounded p-3 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusColor(p.status)}`} />
                <span className="text-sm font-medium">{p.phase_name}</span>
                <span className="text-xs text-muted-foreground">#{p.phase_order}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(p.status)}`}>
                {p.status}
              </span>
            </div>

            {p.started_at && (
              <div className="text-xs text-muted-foreground">
                Started: {formatTime(p.started_at)}
                {p.completed_at && <> | Completed: {formatTime(p.completed_at)}</>}
              </div>
            )}

            {p.approved_by && (
              <div className="text-xs text-green-400">
                Approved by {p.approved_by} at {formatTime(p.approved_at)}
              </div>
            )}

            {p.validation_error && (
              <div className="text-xs text-red-400 bg-red-500/5 p-2 rounded">
                {p.validation_error}
              </div>
            )}

            {p.output_artifact != null && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Output artifact
                </summary>
                <pre className="mt-1 p-2 bg-muted/50 rounded overflow-auto max-h-40 text-[11px]">
                  {JSON.stringify(p.output_artifact, null, 2)}
                </pre>
              </details>
            )}

            {p.status === 'paused' && (
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => handleApprove(p.id)}
                  disabled={actionLoading}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(p.id)}
                  disabled={actionLoading}
                  className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Templates Tab ──

function TemplatesTab({
  templates,
  loading,
  onStartRun,
}: {
  templates: WorkflowTemplate[]
  loading: boolean
  onStartRun: (templateId: number) => void
}) {
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading templates...</div>

  if (templates.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No workflow templates yet. Create one from the API.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {templates.map((t) => (
        <div key={t.id} className="border border-border rounded p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-sm">{t.name}</span>
              {t.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => onStartRun(t.id)}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              Start Run
            </button>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>{t.phases.length} phase{t.phases.length !== 1 ? 's' : ''}</span>
            <span>Model: {t.model}</span>
            <span>Used {t.use_count}x</span>
            {t.phases.some((p) => p.requires_approval) && (
              <span className="text-yellow-400">Has approval gates</span>
            )}
          </div>
          {t.phases.length > 0 && (
            <div className="flex gap-1 mt-1">
              {t.phases.map((p, i) => (
                <div key={p.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {i > 0 && <span className="text-muted-foreground/50">-&gt;</span>}
                  <span className={p.requires_approval ? 'text-yellow-400' : ''}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Runs Tab ──

function RunsTab({
  runs,
  loading,
  onSelectRun,
  statusFilter,
  setStatusFilter,
}: {
  runs: WorkflowRun[]
  loading: boolean
  onSelectRun: (id: number) => void
  statusFilter: string
  setStatusFilter: (s: string) => void
}) {
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading runs...</div>

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex gap-2 mb-2">
        {['all', 'running', 'paused', 'completed', 'failed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2 py-1 text-xs rounded border ${
              statusFilter === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No workflow runs{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        runs.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRun(r.id)}
            className="border border-border rounded p-3 flex items-center justify-between text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{r.template_name}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(r.status)}`}>
                  {r.status}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Run #{r.id} | {r.created_by} | {formatTime(r.started_at)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">-&gt;</span>
          </button>
        ))
      )}
    </div>
  )
}

// ── Main Panel ──

export function WorkflowPanel() {
  const [tab, setTab] = useState<'templates' | 'runs'>('runs')
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const res = await fetch('/api/workflows', {

      })
      if (!res.ok) throw new Error('Failed to fetch templates')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/workflows/runs?${params}`, {

      })
      if (!res.ok) throw new Error('Failed to fetch runs')
      const data = await res.json()
      setRuns(data.runs || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs')
    } finally {
      setLoadingRuns(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])
  useEffect(() => { fetchRuns() }, [fetchRuns])

  // SSE auto-refresh on workflow events
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type?.startsWith('workflow.')) {
          fetchRuns()
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [fetchRuns])

  const handleStartRun = async (templateId: number) => {
    try {
      const res = await fetch('/api/workflows/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      })
      if (!res.ok) throw new Error('Failed to start run')
      const data = await res.json()
      setTab('runs')
      setSelectedRunId(data.runId)
      await fetchRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run')
    }
  }

  if (selectedRunId !== null) {
    return (
      <WorkflowRunDetail
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-500/5 border-b border-red-500/20">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex border-b border-border">
        <button
          onClick={() => setTab('runs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'runs'
              ? 'border-blue-500 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Active Runs
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'templates'
              ? 'border-blue-500 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Templates
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'templates' ? (
          <TemplatesTab
            templates={templates}
            loading={loadingTemplates}
            onStartRun={handleStartRun}
          />
        ) : (
          <RunsTab
            runs={runs}
            loading={loadingRuns}
            onSelectRun={setSelectedRunId}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        )}
      </div>
    </div>
  )
}
