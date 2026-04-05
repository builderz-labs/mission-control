/**
 * Council Deliberation Types
 * WHY: Structured multi-agent deliberation requires typed contracts
 * so each C-Suite agent vote can be aggregated and synthesized safely.
 */

export type DeliberationStatus = 'open' | 'synthesizing' | 'complete' | 'deadlock'
export type VoteStance = 'support' | 'oppose' | 'neutral' | 'abstain'
export type RoundResult = 'continue' | 'synthesize' | 'deadlock'

export interface Deliberation {
  readonly id: number
  readonly topic: string
  readonly context: Record<string, unknown>
  readonly workspaceId: number
  readonly status: DeliberationStatus
  readonly round: number
  readonly synthesis: string | null
  readonly startedAt: number
  readonly completedAt: number | null
}

export interface Vote {
  readonly id: number
  readonly deliberationId: number
  readonly agentId: string
  readonly round: number
  readonly position: string
  readonly stance: VoteStance
  readonly confidence: number
  readonly workspaceId: number
  readonly createdAt: number
}

export interface SubmitVoteInput {
  readonly deliberationId: number
  readonly agentId: string
  readonly round: number
  readonly position: string
  readonly stance: VoteStance
  readonly confidence: number
  readonly workspaceId: number
}

export interface DeliberationWithVotes extends Deliberation {
  readonly votes: ReadonlyArray<Vote>
}

/**
 * Raw SQLite row shape — columns use snake_case from the DB schema.
 * WHY: Separate from the domain type so we can map once at the boundary.
 */
export interface DeliberationRow {
  id: number
  topic: string
  context: string
  workspace_id: number
  status: string
  round: number
  synthesis: string | null
  started_at: number
  completed_at: number | null
}

export interface VoteRow {
  id: number
  deliberation_id: number
  agent_id: string
  round: number
  position: string
  stance: string
  confidence: number
  workspace_id: number
  created_at: number
}
