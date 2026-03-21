import type { Task } from './db'

export const PROJECT_WORKFLOW_MODES = ['standard', 'edict_v1'] as const
export type ProjectWorkflowMode = typeof PROJECT_WORKFLOW_MODES[number]

export const EDICT_WORKFLOW_TEMPLATE = 'edict_v1'

export type EdictStage =
  | 'intake'
  | 'planning'
  | 'deliberation'
  | 'dispatch'
  | 'execution'
  | 'review'
  | 'done'

type StageDefinition = {
  stage: EdictStage
  status: Task['status']
  role: string
  columnTitle: string
  badgeLabel: string
}

export const EDICT_STAGE_SEQUENCE: StageDefinition[] = [
  { stage: 'intake', status: 'inbox', role: 'intake lead', columnTitle: 'Intake', badgeLabel: 'Intake' },
  { stage: 'planning', status: 'assigned', role: 'planner', columnTitle: 'Planning', badgeLabel: 'Planning' },
  { stage: 'deliberation', status: 'awaiting_owner', role: 'deliberation lead', columnTitle: 'Deliberation', badgeLabel: 'Deliberation' },
  { stage: 'dispatch', status: 'review', role: 'dispatcher', columnTitle: 'Dispatch', badgeLabel: 'Dispatch' },
  { stage: 'execution', status: 'in_progress', role: 'executor', columnTitle: 'Execution', badgeLabel: 'Execution' },
  { stage: 'review', status: 'quality_review', role: 'reviewer', columnTitle: 'Review', badgeLabel: 'Review' },
  { stage: 'done', status: 'done', role: 'closer', columnTitle: 'Done', badgeLabel: 'Done' },
]

const EDICT_STATUS_INDEX = new Map(
  EDICT_STAGE_SEQUENCE.map((definition, index) => [definition.status, index])
)

export function normalizeProjectWorkflowMode(input: unknown): ProjectWorkflowMode {
  return input === EDICT_WORKFLOW_TEMPLATE || input === 'edict' || input === 'edict_v1'
    ? 'edict_v1'
    : 'standard'
}

export function normalizeProjectWorkflowTemplate(input: unknown): string | null {
  return normalizeProjectWorkflowMode(input) === 'edict_v1' ? EDICT_WORKFLOW_TEMPLATE : null
}

export function isEdictWorkflowMode(mode: unknown): mode is 'edict_v1' {
  return normalizeProjectWorkflowMode(mode) === 'edict_v1'
}

export function getEdictStageDefinition(status: string): StageDefinition | null {
  return EDICT_STAGE_SEQUENCE.find((definition) => definition.status === status) || null
}

export function getProjectWorkflowSemantics(project: {
  workflow_mode?: unknown
  workflow_template?: unknown
} | null | undefined, status: string): {
  workflowMode: ProjectWorkflowMode
  workflowLabel: string | null
  stage: string | null
  role: string | null
  badgeLabel: string | null
} {
  const workflowMode = normalizeProjectWorkflowMode(project?.workflow_mode ?? project?.workflow_template)
  if (workflowMode !== 'edict_v1') {
    return {
      workflowMode,
      workflowLabel: null,
      stage: null,
      role: null,
      badgeLabel: null,
    }
  }

  const stage = getEdictStageDefinition(status)
  return {
    workflowMode,
    workflowLabel: 'Edict v1',
    stage: stage?.stage || null,
    role: stage?.role || null,
    badgeLabel: stage?.badgeLabel || null,
  }
}

export function getEdictColumnTitle(status: string): string | null {
  return getEdictStageDefinition(status)?.columnTitle || null
}

export function getEdictColumnOrder(): Task['status'][] {
  return EDICT_STAGE_SEQUENCE.map((definition) => definition.status)
}

export function validateEdictTaskTransition(args: {
  currentStatus?: Task['status'] | null
  nextStatus: Task['status']
}): { ok: true } | { ok: false; error: string } {
  const nextIndex = EDICT_STATUS_INDEX.get(args.nextStatus)
  if (nextIndex === undefined) {
    return { ok: false, error: `Unsupported edict workflow status: ${args.nextStatus}` }
  }

  if (!args.currentStatus) {
    if (nextIndex <= 1) return { ok: true }
    return { ok: false, error: 'Edict tasks must begin in intake or planning.' }
  }

  const currentIndex = EDICT_STATUS_INDEX.get(args.currentStatus)
  if (currentIndex === undefined) {
    return { ok: false, error: `Unsupported edict workflow status: ${args.currentStatus}` }
  }

  if (nextIndex <= currentIndex + 1) return { ok: true }

  const requiredNext = EDICT_STAGE_SEQUENCE[currentIndex + 1]
  return {
    ok: false,
    error: `Edict workflow cannot skip gates. Move task to ${requiredNext.columnTitle.toLowerCase()} before ${EDICT_STAGE_SEQUENCE[nextIndex].columnTitle.toLowerCase()}.`,
  }
}
