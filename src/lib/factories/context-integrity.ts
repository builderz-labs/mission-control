import type { FactorySnapshot, FactoryWorkItem } from './types'

export type WorkSelectionMode = 'implicit_continuation' | 'explicit_target'

export interface WorkSelectionRequest {
  mode: WorkSelectionMode
  target_id: string
  source_revision: string
}

export type WorkSelectionResult =
  | { ok: true; selected_work_item: FactoryWorkItem }
  | {
      ok: false
      code: 'STALE_CONTEXT' | 'NO_WORK_CONTEXT' | 'INVALID_SELECTION'
      reason: string
      authoritative_primary_target: FactoryWorkItem | null
    }

/** Validate a planner selection against the current authoritative snapshot. */
export function validateWorkSelection(
  snapshot: Pick<FactorySnapshot, 'work_context'> & { source: Pick<FactorySnapshot['source'], 'revision'> },
  request: WorkSelectionRequest,
): WorkSelectionResult {
  const workContext = snapshot.work_context
  if (!workContext) {
    return {
      ok: false,
      code: 'NO_WORK_CONTEXT',
      reason: 'The authoritative snapshot does not provide a work context; refusing to infer a target.',
      authoritative_primary_target: null,
    }
  }

  const primary = workContext.primary_work_item
  const staleResult = (reason: string): WorkSelectionResult => ({
    ok: false,
    code: 'STALE_CONTEXT',
    reason,
    authoritative_primary_target: primary,
  })

  if (
    !request.source_revision
    || request.source_revision !== snapshot.source.revision
    || workContext.source_revision !== snapshot.source.revision
  ) return staleResult('The supplied source revision does not match the current authoritative work context.')

  if (request.mode === 'implicit_continuation') {
    if (primary?.target_id === request.target_id) return { ok: true, selected_work_item: primary }
    return staleResult(
      `Implicit continuation target ${request.target_id} does not match the authoritative primary target ${primary?.target_id || 'none'}.`,
    )
  }

  const selected = workContext.ordered_work_queue.find((item) => item.target_id === request.target_id)
  if (selected) return { ok: true, selected_work_item: selected }
  return {
    ok: false,
    code: 'INVALID_SELECTION',
    reason: 'The requested explicit target is not present in the authoritative ordered work queue.',
    authoritative_primary_target: primary,
  }
}
