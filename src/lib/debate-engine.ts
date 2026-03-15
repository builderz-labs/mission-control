import type { Database } from 'better-sqlite3'
import { writeTransaction } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'

// --- Types ---

export interface DebateRow {
  id: number
  topic: string
  status: 'pending' | 'propose' | 'critique' | 'rebut' | 'vote' | 'concluded' | 'budget_exhausted'
  current_round: number
  max_rounds: number
  token_budget: number
  tokens_used: number
  outcome: string | null
  vote_accept: number
  vote_reject: number
  workspace_id: number
  created_by: string
  created_at: number
  concluded_at: number | null
}

export interface DebateArgumentRow {
  id: number
  debate_id: number
  agent_id: number
  agent_name: string
  round_number: number
  phase: 'propose' | 'critique' | 'rebut'
  content: string
  confidence: number
  tokens_used: number
  created_at: number
}

export interface DebateVoteRow {
  id: number
  debate_id: number
  agent_id: number
  agent_name: string
  vote: 'accept' | 'reject'
  reason: string | null
  created_at: number
}

export interface DebateParticipantRow {
  debate_id: number
  agent_id: number
  agent_name: string
  joined_at: number
}

type DebatePhase = 'propose' | 'critique' | 'rebut' | 'vote'
const PHASE_ORDER: DebatePhase[] = ['propose', 'critique', 'rebut', 'vote']

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// --- Core Functions ---

export function createDebate(
  db: Database,
  topic: string,
  participantIds: number[],
  maxRounds: number,
  tokenBudget: number,
  createdBy: string,
  workspaceId: number
): { debateId: number } {
  if (participantIds.length < 2) {
    throw new Error('Debate requires at least 2 participants')
  }

  const result = writeTransaction(db, (txDb) => {
    const insertResult = txDb.prepare(`
      INSERT INTO debates (topic, status, max_rounds, token_budget, created_by, workspace_id)
      VALUES (?, 'propose', ?, ?, ?, ?)
    `).run(topic, maxRounds, tokenBudget, createdBy, workspaceId)

    const debateId = Number(insertResult.lastInsertRowid)

    const insertParticipant = txDb.prepare(`
      INSERT INTO debate_participants (debate_id, agent_id, agent_name)
      VALUES (?, ?, ?)
    `)

    for (const agentId of participantIds) {
      const agent = txDb.prepare('SELECT name FROM agents WHERE id = ? AND workspace_id = ?')
        .get(agentId, workspaceId) as { name: string } | undefined

      if (!agent) {
        throw new Error(`Agent ${agentId} not found in workspace ${workspaceId}`)
      }

      insertParticipant.run(debateId, agentId, agent.name)
    }

    return debateId
  })

  eventBus.broadcast('debate.created', {
    debateId: result,
    topic,
    participantCount: participantIds.length,
  })

  logger.info({ debateId: result, topic, participants: participantIds.length }, 'Debate created')

  return { debateId: result }
}

export function submitArgument(
  db: Database,
  debateId: number,
  agentId: number,
  content: string,
  confidence: number
): { id: number; budgetRemaining: number } {
  const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
  if (!debate) throw new Error('Debate not found')

  const validPhases = ['propose', 'critique', 'rebut']
  if (!validPhases.includes(debate.status)) {
    throw new Error(`Cannot submit argument in ${debate.status} phase`)
  }

  // Check participant
  const participant = db.prepare(
    'SELECT agent_name FROM debate_participants WHERE debate_id = ? AND agent_id = ?'
  ).get(debateId, agentId) as { agent_name: string } | undefined
  if (!participant) throw new Error('Agent is not a participant in this debate')

  // Check if already submitted for this round+phase
  const existing = db.prepare(
    'SELECT id FROM debate_arguments WHERE debate_id = ? AND agent_id = ? AND round_number = ? AND phase = ?'
  ).get(debateId, agentId, debate.current_round, debate.status)
  if (existing) throw new Error('Agent already submitted argument for this round and phase')

  // Check token budget
  const tokens = estimateTokens(content)
  if (debate.tokens_used + tokens > debate.token_budget) {
    db.prepare('UPDATE debates SET status = ?, concluded_at = unixepoch() WHERE id = ?')
      .run('budget_exhausted', debateId)
    throw new Error('Token budget exhausted')
  }

  const result = db.prepare(`
    INSERT INTO debate_arguments (debate_id, agent_id, agent_name, round_number, phase, content, confidence, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(debateId, agentId, participant.agent_name, debate.current_round, debate.status, content, confidence, tokens)

  db.prepare('UPDATE debates SET tokens_used = tokens_used + ? WHERE id = ?').run(tokens, debateId)

  const argId = Number(result.lastInsertRowid)

  eventBus.broadcast('debate.argument.submitted', {
    debateId,
    agentName: participant.agent_name,
    roundNumber: debate.current_round,
  })

  return {
    id: argId,
    budgetRemaining: debate.token_budget - debate.tokens_used - tokens,
  }
}

export function advanceDebatePhase(
  db: Database,
  debateId: number
): { status: string; round: number; phase?: string } {
  const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
  if (!debate) throw new Error('Debate not found')

  if (debate.status === 'concluded' || debate.status === 'budget_exhausted') {
    throw new Error(`Debate already ended: ${debate.status}`)
  }

  const currentPhaseIdx = PHASE_ORDER.indexOf(debate.status as DebatePhase)
  if (currentPhaseIdx === -1) {
    throw new Error(`Cannot advance from status: ${debate.status}`)
  }

  // If current phase is 'vote', tally and potentially conclude or advance round
  if (debate.status === 'vote') {
    return tallyAndAdvance(db, debate)
  }

  // Advance to next phase in sequence
  const nextPhase = PHASE_ORDER[currentPhaseIdx + 1]
  db.prepare('UPDATE debates SET status = ? WHERE id = ?').run(nextPhase, debateId)

  eventBus.broadcast('debate.round.started', {
    debateId,
    roundNumber: debate.current_round,
    phase: nextPhase,
  })

  return { status: nextPhase, round: debate.current_round, phase: nextPhase }
}

function tallyAndAdvance(
  db: Database,
  debate: DebateRow
): { status: string; round: number; phase?: string } {
  const votes = db.prepare(
    'SELECT vote FROM debate_votes WHERE debate_id = ?'
  ).all(debate.id) as Array<{ vote: string }>

  const accept = votes.filter(v => v.vote === 'accept').length
  const reject = votes.filter(v => v.vote === 'reject').length
  const total = accept + reject

  // Update vote counts
  db.prepare('UPDATE debates SET vote_accept = ?, vote_reject = ? WHERE id = ?')
    .run(accept, reject, debate.id)

  // Consensus: majority accepts (>50%)
  if (total > 0 && accept > total / 2) {
    db.prepare('UPDATE debates SET status = ?, outcome = ?, concluded_at = unixepoch() WHERE id = ?')
      .run('concluded', 'accepted', debate.id)

    eventBus.broadcast('debate.concluded', {
      debateId: debate.id,
      outcome: 'accepted',
      voteCount: { accept, reject },
    })

    return { status: 'concluded', round: debate.current_round }
  }

  // Max rounds reached
  if (debate.current_round >= debate.max_rounds) {
    const outcome = reject > accept ? 'rejected' : 'no_consensus'
    db.prepare('UPDATE debates SET status = ?, outcome = ?, concluded_at = unixepoch() WHERE id = ?')
      .run('concluded', outcome, debate.id)

    eventBus.broadcast('debate.concluded', {
      debateId: debate.id,
      outcome,
      voteCount: { accept, reject },
    })

    return { status: 'concluded', round: debate.current_round }
  }

  // Advance to next round
  const nextRound = debate.current_round + 1
  db.prepare('UPDATE debates SET status = ?, current_round = ? WHERE id = ?')
    .run('propose', nextRound, debate.id)

  // Clear votes for new round
  db.prepare('DELETE FROM debate_votes WHERE debate_id = ?').run(debate.id)

  eventBus.broadcast('debate.round.completed', {
    debateId: debate.id,
    roundNumber: debate.current_round,
  })

  eventBus.broadcast('debate.round.started', {
    debateId: debate.id,
    roundNumber: nextRound,
    phase: 'propose',
  })

  return { status: 'propose', round: nextRound, phase: 'propose' }
}

export function castVote(
  db: Database,
  debateId: number,
  agentId: number,
  vote: 'accept' | 'reject',
  reason?: string
): { allVoted: boolean; accept: number; reject: number } {
  const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
  if (!debate) throw new Error('Debate not found')
  if (debate.status !== 'vote') throw new Error('Debate is not in voting phase')

  const participant = db.prepare(
    'SELECT agent_name FROM debate_participants WHERE debate_id = ? AND agent_id = ?'
  ).get(debateId, agentId) as { agent_name: string } | undefined
  if (!participant) throw new Error('Agent is not a participant')

  db.prepare(`
    INSERT INTO debate_votes (debate_id, agent_id, agent_name, vote, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(debateId, agentId, participant.agent_name, vote, reason || null)

  eventBus.broadcast('debate.vote.cast', {
    debateId,
    agentName: participant.agent_name,
    vote,
  })

  // Check if all participants have voted
  const participantCount = (db.prepare(
    'SELECT COUNT(*) as count FROM debate_participants WHERE debate_id = ?'
  ).get(debateId) as { count: number }).count

  const voteCount = (db.prepare(
    'SELECT COUNT(*) as count FROM debate_votes WHERE debate_id = ?'
  ).get(debateId) as { count: number }).count

  const votes = db.prepare(
    'SELECT vote FROM debate_votes WHERE debate_id = ?'
  ).all(debateId) as Array<{ vote: string }>

  const accept = votes.filter(v => v.vote === 'accept').length
  const reject = votes.filter(v => v.vote === 'reject').length

  return { allVoted: voteCount >= participantCount, accept, reject }
}

export function getDebateStatus(
  db: Database,
  debateId: number
): {
  debate: DebateRow
  participants: DebateParticipantRow[]
  arguments: DebateArgumentRow[]
  votes: DebateVoteRow[]
} | null {
  const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
  if (!debate) return null

  const participants = db.prepare(
    'SELECT * FROM debate_participants WHERE debate_id = ? ORDER BY joined_at ASC'
  ).all(debateId) as DebateParticipantRow[]

  const args = db.prepare(
    'SELECT * FROM debate_arguments WHERE debate_id = ? ORDER BY round_number ASC, created_at ASC'
  ).all(debateId) as DebateArgumentRow[]

  const votes = db.prepare(
    'SELECT * FROM debate_votes WHERE debate_id = ? ORDER BY created_at ASC'
  ).all(debateId) as DebateVoteRow[]

  return { debate, participants, arguments: args, votes }
}

export function concludeDebate(
  db: Database,
  debateId: number,
  outcome: string
): void {
  const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
  if (!debate) throw new Error('Debate not found')

  db.prepare('UPDATE debates SET status = ?, outcome = ?, concluded_at = unixepoch() WHERE id = ?')
    .run('concluded', outcome, debateId)

  const votes = db.prepare('SELECT vote FROM debate_votes WHERE debate_id = ?').all(debateId) as Array<{ vote: string }>
  const accept = votes.filter(v => v.vote === 'accept').length
  const reject = votes.filter(v => v.vote === 'reject').length

  eventBus.broadcast('debate.concluded', {
    debateId,
    outcome,
    voteCount: { accept, reject },
  })
}
