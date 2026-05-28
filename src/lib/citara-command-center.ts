export type CommandCenterTone = 'clear' | 'active' | 'review' | 'running' | 'critical'
export type ApprovalAction = 'approve' | 'request_changes' | 'reject'
export type ApprovalActionTone = 'success' | 'warning' | 'danger'

export interface CommandCenterCounts {
  awaiting_owner?: number
  in_progress?: number
  quality_review?: number
  review?: number
  failed?: number
  done?: number
}

export interface CommandCenterSummaryInput {
  agentsReady: number
  awaitingOwner: number
  inProgress: number
  qualityReview: number
  failed: number
  done: number
}

export interface FleetRunnerEvent {
  ts?: string
  exit_code?: number
  elapsed_seconds?: number
  summary?: {
    agents_checked?: number
    tasks_found?: number
    tasks_processed?: number
    errors?: unknown[]
  }
}

export type BenchmarkSource = 'Langfuse' | 'LangSmith' | 'CrewAI' | 'AutoGPT' | 'Dify' | 'Flowise'
export type BenchmarkStatus = 'ok' | 'watch' | 'action'

export interface CommandCenterBenchmarkInput {
  awaitingOwner: number
  inProgress: number
  qualityReview: number
  failed: number
  done: number
  agentsReady: number
  topics?: Array<{
    topic: string
    agent?: string
    signal?: string
    tasks?: {
      total?: number
      active?: number
      review?: number
      done?: number
      failed?: number
    }
  }>
  clients?: Array<{
    name: string
    open?: number
    review?: number
    failed?: number
    done?: number
    total?: number
  }>
  lastRunnerEvent?: FleetRunnerEvent | null
}

export interface CommandCenterBenchmarkCard {
  source: BenchmarkSource
  optimization: string
  signal: string
  action: string
  status: BenchmarkStatus
}

export function commandCenterHealthLabel(counts: CommandCenterCounts): {
  tone: CommandCenterTone
  label: string
  description: string
} {
  const failed = Number(counts.failed || 0)
  const review = Number(counts.quality_review || counts.review || 0)
  const running = Number(counts.in_progress || 0)
  const queue = Number(counts.awaiting_owner || 0)

  if (failed > 0) {
    return {
      tone: 'critical',
      label: 'Atenção',
      description: 'Existem falhas abertas que precisam de correção.',
    }
  }
  if (review > 0) {
    return {
      tone: 'review',
      label: 'Revisão',
      description: 'Há entregas aguardando aprovação humana.',
    }
  }
  if (running > 0) {
    return {
      tone: 'running',
      label: 'Executando',
      description: 'Hermes está processando tasks agora.',
    }
  }
  if (queue > 0) {
    return {
      tone: 'active',
      label: 'Fila ativa',
      description: 'Há tasks prontas para o Hermes Adapter.',
    }
  }
  return {
    tone: 'clear',
    label: 'Limpo',
    description: 'Sem falhas, sem fila e sem revisão pendente.',
  }
}

function plural(value: number, singular: string, pluralLabel: string): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`
}

export function summarizeCommandCenter(input: CommandCenterSummaryInput): string[] {
  return [
    `${input.agentsReady}/9 agentes Cítara prontos`,
    plural(input.awaitingOwner, 'task aguardando Hermes Adapter', 'tasks aguardando Hermes Adapter'),
    plural(input.inProgress, 'task em execução', 'tasks em execução'),
    plural(input.qualityReview, 'entrega aguardando revisão humana', 'entregas aguardando revisão humana'),
    `${input.done} concluídas`,
  ]
}

export function approvalActionLabel(action: ApprovalAction): { label: string; tone: ApprovalActionTone } {
  if (action === 'approve') return { label: 'Aprovar', tone: 'success' }
  if (action === 'request_changes') return { label: 'Pedir ajustes', tone: 'warning' }
  return { label: 'Reprovar', tone: 'danger' }
}

export function formatLastRunnerEvent(event: FleetRunnerEvent | null | undefined): string {
  if (!event) return 'Sem execução registrada ainda'

  const ts = event.ts || 'sem timestamp'
  const exitCode = typeof event.exit_code === 'number' ? event.exit_code : 'n/a'
  const processed = Number(event.summary?.tasks_processed || 0)
  const found = Number(event.summary?.tasks_found || 0)
  const agents = Number(event.summary?.agents_checked || 0)
  const elapsed = typeof event.elapsed_seconds === 'number' ? `${event.elapsed_seconds.toFixed(1)}s` : 'tempo n/a'

  return `${ts} · exit ${exitCode} · ${processed}/${found} tasks processadas · ${agents} agentes · ${elapsed}`
}

function statusFor(count: number, warnAt = 1): BenchmarkStatus {
  return count >= warnAt ? 'action' : 'ok'
}

function busiestTopic(input: CommandCenterBenchmarkInput): string {
  const topic = (input.topics || [])
    .slice()
    .sort((a, b) => Number(b.tasks?.active || 0) + Number(b.tasks?.review || 0) + Number(b.tasks?.failed || 0)
      - (Number(a.tasks?.active || 0) + Number(a.tasks?.review || 0) + Number(a.tasks?.failed || 0)))[0]

  if (!topic) return 'Sem tópico dominante nesta leitura.'
  const load = Number(topic.tasks?.active || 0) + Number(topic.tasks?.review || 0) + Number(topic.tasks?.failed || 0)
  return `${topic.topic}: ${load} pendências visíveis.`
}

function topClient(input: CommandCenterBenchmarkInput): string {
  const client = (input.clients || [])
    .slice()
    .sort((a, b) => Number(b.open || 0) + Number(b.review || 0) + Number(b.failed || 0)
      - (Number(a.open || 0) + Number(a.review || 0) + Number(a.failed || 0)))[0]

  if (!client) return 'Sem cliente dominante nesta leitura.'
  const load = Number(client.open || 0) + Number(client.review || 0) + Number(client.failed || 0)
  return `${client.name}: ${load} itens abertos/revisão/falha.`
}

export function buildBenchmarkOptimizationCards(input: CommandCenterBenchmarkInput): CommandCenterBenchmarkCard[] {
  const runnerErrors = Array.isArray(input.lastRunnerEvent?.summary?.errors)
    ? input.lastRunnerEvent?.summary?.errors?.length || 0
    : 0
  const processed = Number(input.lastRunnerEvent?.summary?.tasks_processed || 0)
  const found = Number(input.lastRunnerEvent?.summary?.tasks_found || 0)
  const totalVisible = input.awaitingOwner + input.inProgress + input.qualityReview + input.failed + input.done
  const doneRate = totalVisible > 0 ? Math.round((input.done / totalVisible) * 100) : 100

  return [
    {
      source: 'Langfuse',
      optimization: 'Trace-first: evidência de custo/erro junto da execução',
      signal: runnerErrors > 0 ? `${runnerErrors} erro(s) no último runner.` : `Último runner processou ${processed}/${found} tasks.`,
      action: runnerErrors > 0 ? 'Abrir log da execução antes de rodar nova leva.' : 'Manter o último runner como trilha auditável do Resumo do General.',
      status: statusFor(runnerErrors),
    },
    {
      source: 'LangSmith',
      optimization: 'Checkpoint humano: revisar antes de seguir',
      signal: `${input.qualityReview} entrega(s) em quality_review.`,
      action: input.qualityReview > 0 ? 'Aprovar, pedir ajustes ou reprovar direto pelo card.' : 'Sem checkpoint humano pendente agora.',
      status: statusFor(input.qualityReview),
    },
    {
      source: 'CrewAI',
      optimization: 'Visão por missão/equipe, não só task solta',
      signal: busiestTopic(input),
      action: 'Usar o tópico mais carregado como próxima missão da frota.',
      status: input.inProgress > 0 || input.awaitingOwner > 0 ? 'watch' : 'ok',
    },
    {
      source: 'AutoGPT',
      optimization: 'Action block reutilizável para fila pronta',
      signal: `${input.awaitingOwner} task(s) aguardando Hermes Adapter.`,
      action: input.awaitingOwner > 0 ? 'Rodar Fleet Runner como bloco operacional seguro.' : 'Criar próxima task awaiting_owner antes de rodar automação.',
      status: input.awaitingOwner > 0 ? 'watch' : 'ok',
    },
    {
      source: 'Dify',
      optimization: 'Ops Health simples: sucesso, falha e gargalo visível',
      signal: `${doneRate}% concluídas na amostra visível; ${input.failed} falha(s).`,
      action: input.failed > 0 ? 'Resolver falhas antes de aumentar volume.' : 'Acompanhar taxa de conclusão no Command Center.',
      status: statusFor(input.failed),
    },
    {
      source: 'Flowise',
      optimization: 'Debug overlay: status por nó/cliente em vez de log cru',
      signal: topClient(input),
      action: 'Priorizar o cliente/frente com maior carga operacional.',
      status: input.failed > 0 || input.qualityReview > 0 ? 'watch' : 'ok',
    },
  ]
}
