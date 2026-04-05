/**
 * Council Deliberation Engine
 * WHY: Implements the 7-step council protocol from council-of-high-intelligence
 * adapted for Ultron's C-Suite hierarchy. Persists all votes and syntheses
 * to SQLite for full audit trail.
 */

import { getDatabase } from '../db'
import { logger } from '../logger'
import {
  emitDeliberationStarted,
  emitDeliberationCompleted,
  emitVoteCast,
  emitSynthesisReached,
} from '../autonomous-events'
import type {
  Deliberation,
  Vote,
  SubmitVoteInput,
  DeliberationWithVotes,
  RoundResult,
  DeliberationRow,
  VoteRow,
} from './types'
import { computeConsensus, evaluateRound } from './scoring'

/** Maps a snake_case DB row to the camelCase domain type. */
function rowToDeliberation(row: DeliberationRow): Deliberation {
  return {
    id: row.id,
    topic: row.topic,
    context: JSON.parse(row.context || '{}') as Record<string, unknown>,
    workspaceId: row.workspace_id,
    status: row.status as Deliberation['status'],
    round: row.round,
    synthesis: row.synthesis,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

/** Maps a snake_case DB row to the camelCase Vote domain type. */
function rowToVote(row: VoteRow): Vote {
  return {
    id: row.id,
    deliberationId: row.deliberation_id,
    agentId: row.agent_id,
    round: row.round,
    position: row.position,
    stance: row.stance as Vote['stance'],
    confidence: row.confidence,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
  }
}

export class CouncilDeliberationEngine {
  private constructor() {}

  static getInstance(): CouncilDeliberationEngine {
    const g = globalThis as typeof globalThis & { __councilEngine?: CouncilDeliberationEngine }
    g.__councilEngine ??= new CouncilDeliberationEngine()
    return g.__councilEngine
  }

  async startDeliberation(
    topic: string,
    context: Record<string, unknown>,
    workspaceId: number = 1
  ): Promise<number> {
    const db = getDatabase()
    const result = db.prepare(`
      INSERT INTO council_deliberations (topic, context, workspace_id, status, round)
      VALUES (?, ?, ?, 'open', 1)
    `).run(topic, JSON.stringify(context), workspaceId)

    const id = result.lastInsertRowid as number
    logger.info({ deliberationId: id, topic, workspaceId }, 'Council deliberation started')
    emitDeliberationStarted(id, topic, workspaceId)
    return id
  }

  async submitVote(input: SubmitVoteInput): Promise<void> {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO council_votes (deliberation_id, agent_id, round, position, stance, confidence, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.deliberationId,
      input.agentId,
      input.round,
      input.position,
      input.stance,
      input.confidence,
      input.workspaceId
    )
    emitVoteCast(input.deliberationId, input.agentId, input.round, input.stance)
  }

  async advanceRound(deliberationId: number): Promise<RoundResult> {
    const db = getDatabase()
    const row = db.prepare(
      `SELECT * FROM council_deliberations WHERE id = ?`
    ).get(deliberationId) as DeliberationRow | undefined

    if (!row) throw new Error(`Deliberation ${deliberationId} not found`)

    const voteRows = db.prepare(
      `SELECT * FROM council_votes WHERE deliberation_id = ? AND round = ?`
    ).all(deliberationId, row.round) as VoteRow[]

    const votes = voteRows.map(rowToVote)
    const result = evaluateRound(votes, row.round)

    if (result === 'continue') {
      db.prepare(`UPDATE council_deliberations SET round = round + 1 WHERE id = ?`).run(deliberationId)
    } else if (result === 'synthesize') {
      db.prepare(`UPDATE council_deliberations SET status = 'synthesizing' WHERE id = ?`).run(deliberationId)
    } else {
      db.prepare(`UPDATE council_deliberations SET status = 'deadlock' WHERE id = ?`).run(deliberationId)
    }

    return result
  }

  async synthesize(deliberationId: number): Promise<string> {
    const db = getDatabase()
    const voteRows = db.prepare(
      `SELECT * FROM council_votes WHERE deliberation_id = ?`
    ).all(deliberationId) as VoteRow[]

    const votes = voteRows.map(rowToVote)
    const score = computeConsensus(votes)
    const supportingAgents = votes.filter(v => v.stance === 'support').map(v => v.agentId)
    const opposingAgents = votes.filter(v => v.stance === 'oppose').map(v => v.agentId)

    // Build synthesis summary from aggregated vote data
    const synthesis = JSON.stringify({
      consensus: score.weightedConsensus,
      supportRatio: score.supportRatio,
      opposeRatio: score.opposeRatio,
      supportingAgents,
      opposingAgents,
      totalVotes: votes.length,
    })

    db.prepare(`
      UPDATE council_deliberations
      SET status = 'complete', synthesis = ?, completed_at = unixepoch()
      WHERE id = ?
    `).run(synthesis, deliberationId)

    const delib = db.prepare(
      `SELECT workspace_id FROM council_deliberations WHERE id = ?`
    ).get(deliberationId) as { workspace_id: number } | undefined

    emitSynthesisReached(deliberationId, score.weightedConsensus)
    emitDeliberationCompleted(deliberationId, synthesis, delib?.workspace_id ?? 1)
    return synthesis
  }

  getDeliberation(id: number, workspaceId: number): DeliberationWithVotes | null {
    const db = getDatabase()
    const row = db.prepare(
      `SELECT * FROM council_deliberations WHERE id = ? AND workspace_id = ?`
    ).get(id, workspaceId) as DeliberationRow | undefined

    if (!row) return null

    const voteRows = db.prepare(
      `SELECT * FROM council_votes WHERE deliberation_id = ? ORDER BY round, created_at`
    ).all(id) as VoteRow[]

    return { ...rowToDeliberation(row), votes: voteRows.map(rowToVote) }
  }

  listDeliberations(workspaceId: number, limit: number = 20): ReadonlyArray<Deliberation> {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM council_deliberations WHERE workspace_id = ?
      ORDER BY started_at DESC LIMIT ?
    `).all(workspaceId, limit) as DeliberationRow[]

    return rows.map(rowToDeliberation)
  }
}
