'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  approvalActionLabel,
  buildBenchmarkOptimizationCards,
  commandCenterHealthLabel,
  formatLastRunnerEvent,
  summarizeCommandCenter,
  type ApprovalAction,
  type BenchmarkStatus,
  type FleetRunnerEvent,
} from '@/lib/citara-command-center'

type TopicStatus = {
  topic: string
  agent: string
  role?: string
  status?: string
  signal?: 'attention' | 'working' | 'clear' | string
  tasks?: {
    total?: number
    active?: number
    review?: number
    done?: number
    failed?: number
  }
}

type CompactTask = {
  id: number
  title: string
  status: string
  priority?: string
  assigned_to?: string | null
  topic?: string
  client?: string
  updated_at?: number
  error_message?: string | null
  resolution?: string | null
}

type GeneralReport = {
  ok?: boolean
  title?: string
  generated_at?: string
  summary?: string[]
  counts?: Record<string, number>
  topics?: TopicStatus[]
  recent_tasks?: CompactTask[]
  next_actions?: string[]
}

type GeneralSummary = {
  health?: string
  headline?: string
  clients?: Array<{
    name: string
    open: number
    review: number
    failed: number
    done: number
    total: number
    top_tasks?: CompactTask[]
  }>
  general_report?: {
    nexus_command?: {
      focus?: string
      needs_approval?: CompactTask[]
      blocked?: CompactTask[]
    }
  }
  next_actions?: string[]
}

type FleetStatus = {
  ok?: boolean
  script?: string
  cwd?: string
  log_path?: string
  agents?: {
    total?: number
    hermes_adapter?: number
    idle_or_ready?: number
  }
  tasks?: {
    awaiting_owner?: number
    quality_review?: number
    failed?: number
    counts?: Record<string, number>
  }
  last_runner_event?: FleetRunnerEvent | null
  error?: string
}

const toneClass: Record<string, string> = {
  clear: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  active: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  review: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  critical: 'border-red-500/30 bg-red-500/10 text-red-200',
}

const actionToneClass: Record<string, string> = {
  success: 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10',
  warning: 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10',
  danger: 'border-red-500/40 text-red-200 hover:bg-red-500/10',
}

const benchmarkStatusClass: Record<BenchmarkStatus, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  watch: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  action: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function TaskList({
  title,
  tasks,
  empty,
  reviewActions = false,
  actingTaskId,
  onApprovalAction,
}: {
  title: string
  tasks?: CompactTask[]
  empty: string
  reviewActions?: boolean
  actingTaskId?: number | null
  onApprovalAction?: (task: CompactTask, action: ApprovalAction) => void
}) {
  const visible = (tasks || []).slice(0, 6)
  return (
    <section className="rounded-xl border border-border bg-card/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{visible.length}</span>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {visible.map(task => (
            <div key={`${title}-${task.id}`} className="rounded-lg border border-border/70 bg-background/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">#{task.id} · {task.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.client || task.topic || task.assigned_to || 'Cítara'} · {task.status}
                  </div>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase text-muted-foreground">
                  {task.priority || 'normal'}
                </span>
              </div>
              {(task.error_message || task.resolution) && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {task.error_message || task.resolution}
                </p>
              )}
              {reviewActions && onApprovalAction && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['approve', 'request_changes', 'reject'] as ApprovalAction[]).map(action => {
                    const meta = approvalActionLabel(action)
                    return (
                      <Button
                        key={`${task.id}-${action}`}
                        variant="outline"
                        size="sm"
                        className={actionToneClass[meta.tone]}
                        disabled={actingTaskId === task.id}
                        onClick={() => onApprovalAction(task, action)}
                      >
                        {actingTaskId === task.id ? 'Aplicando...' : meta.label}
                      </Button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function CitaraCommandCenterPanel() {
  const [report, setReport] = useState<GeneralReport | null>(null)
  const [summary, setSummary] = useState<GeneralSummary | null>(null)
  const [fleet, setFleet] = useState<FleetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [actingTaskId, setActingTaskId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [reportRes, summaryRes, fleetRes] = await Promise.all([
        fetch('/api/citara/general-report?limit=8').then(r => r.json()).catch(() => null),
        fetch('/api/citara/general-summary').then(r => r.json()).catch(() => null),
        fetch('/api/hermes/fleet-runner').then(r => r.json()).catch(() => null),
      ])
      setReport(reportRes)
      setSummary(summaryRes)
      setFleet(fleetRes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const counts = report?.counts || fleet?.tasks?.counts || {}
  const awaitingOwner = Number(counts.awaiting_owner ?? fleet?.tasks?.awaiting_owner ?? 0)
  const inProgress = Number(counts.in_progress ?? 0)
  const qualityReview = Number(counts.quality_review ?? fleet?.tasks?.quality_review ?? 0)
  const failed = Number(counts.failed ?? fleet?.tasks?.failed ?? 0)
  const done = Number(counts.done ?? 0)
  const agentsReady = Number(fleet?.agents?.hermes_adapter ?? report?.topics?.length ?? 0)
  const health = commandCenterHealthLabel({ awaiting_owner: awaitingOwner, in_progress: inProgress, quality_review: qualityReview, failed, done })
  const summaryLines = summarizeCommandCenter({ agentsReady, awaitingOwner, inProgress, qualityReview, failed, done })
  const approvalTasks = summary?.general_report?.nexus_command?.needs_approval || []
  const blockedTasks = summary?.general_report?.nexus_command?.blocked || []
  const topClients = (summary?.clients || []).slice(0, 5)

  const runFleetRunner = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch('/api/hermes/fleet-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify_empty: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setMessage({ ok: true, text: String(data.stdout || 'Fleet Runner executado com sucesso.').trim() })
        await fetchData()
      } else {
        setMessage({ ok: false, text: data.error || 'Falha ao executar Fleet Runner.' })
      }
    } catch {
      setMessage({ ok: false, text: 'Erro de rede ao executar Fleet Runner.' })
    } finally {
      setRunning(false)
    }
  }

  const applyApprovalAction = async (task: CompactTask, action: ApprovalAction) => {
    const meta = approvalActionLabel(action)
    setActingTaskId(task.id)
    setMessage(null)
    try {
      const res = await fetch('/api/citara/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: task.id,
          action,
          note: `${meta.label} via Cítara Command Center`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setMessage({ ok: true, text: `Task #${task.id}: ${meta.label} aplicado com sucesso.` })
        await fetchData()
      } else {
        setMessage({ ok: false, text: data.error || `Falha ao aplicar ${meta.label.toLowerCase()} na task #${task.id}.` })
      }
    } catch {
      setMessage({ ok: false, text: `Erro de rede ao aplicar ação na task #${task.id}.` })
    } finally {
      setActingTaskId(null)
    }
  }

  const focus = summary?.general_report?.nexus_command?.focus || report?.next_actions?.[0] || 'Sem bloqueios críticos; definir próxima task real por cliente/agente.'
  const lastRunner = useMemo(() => formatLastRunnerEvent(fleet?.last_runner_event), [fleet?.last_runner_event])
  const benchmarkCards = useMemo(() => buildBenchmarkOptimizationCards({
    awaitingOwner,
    inProgress,
    qualityReview,
    failed,
    done,
    agentsReady,
    topics: report?.topics || [],
    clients: summary?.clients || [],
    lastRunnerEvent: fleet?.last_runner_event || null,
  }), [agentsReady, awaitingOwner, done, failed, fleet?.last_runner_event, inProgress, qualityReview, report?.topics, summary?.clients])

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-card via-card to-background p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Cítara Nexus</div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Command Center</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Cockpit dos 9 tópicos Cítara: fila Hermes Adapter, aprovações, falhas, clientes e Resumo do General.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <span className={`rounded-full border px-3 py-1 text-sm font-medium ${toneClass[health.tone] || toneClass.active}`}>
            {health.label}
          </span>
          <Button onClick={fetchData} variant="outline" disabled={loading || running}>Atualizar</Button>
          <Button onClick={runFleetRunner} disabled={running}>{running ? 'Rodando...' : 'Rodar Fleet Runner'}</Button>
        </div>
      </div>

      {message && (
        <div className={`rounded-xl border p-3 text-sm ${message.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
          <pre className="whitespace-pre-wrap font-sans">{message.text}</pre>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Agentes" value={`${agentsReady}/9`} hint="Hermes Adapter ready" />
        <MetricCard label="Fila" value={awaitingOwner} hint="awaiting_owner" />
        <MetricCard label="Executando" value={inProgress} hint="in_progress" />
        <MetricCard label="Revisão" value={qualityReview} hint="quality_review" />
        <MetricCard label="Falhas" value={failed} hint="failed" />
        <MetricCard label="Concluídas" value={done} hint="done" />
      </div>

      <section className="rounded-xl border border-border bg-card/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Benchmark cirúrgico aplicado</h2>
            <p className="mt-1 text-xs text-muted-foreground">1 otimização operacional extraída de Langfuse, LangSmith, CrewAI, AutoGPT, Dify e Flowise.</p>
          </div>
          <span className="text-xs text-muted-foreground">read-only · sem mudar execução</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {benchmarkCards.map(card => (
            <div key={card.source} className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{card.source}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{card.optimization}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase ${benchmarkStatusClass[card.status]}`}>
                  {card.status}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Sinal: {card.signal}</p>
              <p className="mt-2 text-xs text-foreground/90">Ação: {card.action}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-xl border border-border bg-card/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Resumo do General</h2>
            <span className="text-xs text-muted-foreground">{report?.generated_at ? new Date(report.generated_at).toLocaleString() : loading ? 'carregando' : 'sem timestamp'}</span>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/60 p-4">
            <div className="text-sm font-medium text-foreground">Foco atual</div>
            <p className="mt-1 text-sm text-muted-foreground">{focus}</p>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {summaryLines.map(line => (
              <div key={line} className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                {line}
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            Último Fleet Runner: {lastRunner}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card/80 p-4">
          <h2 className="text-sm font-semibold text-foreground">Próximas ações</h2>
          <div className="mt-3 space-y-2">
            {(report?.next_actions || summary?.next_actions || []).slice(0, 5).map((action, idx) => (
              <div key={`${idx}-${action}`} className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-sm text-muted-foreground">
                {action}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {health.description}
          </p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TaskList
          title="Aguardando aprovação humana"
          tasks={approvalTasks}
          empty="Nenhuma entrega em quality_review agora."
          reviewActions
          actingTaskId={actingTaskId}
          onApprovalAction={applyApprovalAction}
        />
        <TaskList title="Bloqueios / falhas" tasks={blockedTasks} empty="Nenhuma task failed aberta." />
      </div>

      <section className="rounded-xl border border-border bg-card/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">9 tópicos especialistas</h2>
          <span className="text-xs text-muted-foreground">Nexus Command + 8 lanes</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(report?.topics || []).map(topic => (
            <div key={topic.agent} className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{topic.topic}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{topic.agent}</div>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {topic.signal || 'clear'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[11px] text-muted-foreground">
                <span>total<br /><b className="text-foreground">{topic.tasks?.total || 0}</b></span>
                <span>ativas<br /><b className="text-foreground">{topic.tasks?.active || 0}</b></span>
                <span>rev<br /><b className="text-foreground">{topic.tasks?.review || 0}</b></span>
                <span>done<br /><b className="text-foreground">{topic.tasks?.done || 0}</b></span>
                <span>fail<br /><b className="text-foreground">{topic.tasks?.failed || 0}</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Clientes / frentes</h2>
          <span className="text-xs text-muted-foreground">top 5 por atividade recente</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          {topClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem clientes/frentes com task registrada.</p>
          ) : topClients.map(client => (
            <div key={client.name} className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="truncate text-sm font-medium text-foreground">{client.name}</div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span>abertas: <b className="text-foreground">{client.open}</b></span>
                <span>rev: <b className="text-foreground">{client.review}</b></span>
                <span>falhas: <b className="text-foreground">{client.failed}</b></span>
                <span>done: <b className="text-foreground">{client.done}</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
