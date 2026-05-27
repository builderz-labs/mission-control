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
