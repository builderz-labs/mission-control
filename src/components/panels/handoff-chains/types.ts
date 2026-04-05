// Re-export external types so sub-components only import from this file
export type { HandoffChainParsed, HandoffStep } from '@/app/api/handoff-chains/route'
export type { HandoffChainRunWithName } from '@/app/api/handoff-chains/runs/route'

// ─── View state ───────────────────────────────────────────────────────────────

export type View = 'list' | 'builder'

// ─── Builder local types ──────────────────────────────────────────────────────

export interface BuilderStep {
  agentName: string
  promptTemplate: string
  label: string
}

export const EMPTY_STEP: BuilderStep = { agentName: '', promptTemplate: '', label: '' }
