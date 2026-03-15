/**
 * Agent Memory System — Stanford Generative Agents + TinyTroupe dual memory.
 *
 * Three memory types:
 *   - observation: raw events the agent witnessed
 *   - reflection: high-level insights derived from observations
 *   - relationship: how this agent relates to another agent
 *
 * Recall uses composite scoring: normalize(relevance) + normalize(importance) + normalize(recency)
 * Recency decays as 0.99^hours_since_access (AI Town formula).
 *
 * Depends on Phase 0 LLM router for importance scoring and reflection generation.
 */

import { createHash } from 'crypto'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'
import { repairAndParse } from '@/lib/llm/output-repair'
import { z } from 'zod'

// --- Types ---

export interface AgentMemory {
  id: number
  agent_id: number
  type: 'observation' | 'reflection' | 'relationship'
  description: string
  importance: number
  last_access: number
  related_agent_id: number | null
  source_memory_ids: string | null
  workspace_id: number
  created_at: number
}

export interface RecallResult extends AgentMemory {
  score: number
}

// --- Configuration ---

const REFLECTION_THRESHOLD = 500
const RECENCY_DECAY = 0.99
const DEFAULT_TOP_K = 5
const OVERFETCH_FACTOR = 10

// Guard against concurrent reflection for the same agent
const _reflectingAgents = new Set<number>()

// --- Zod schemas for LLM output validation ---

const importanceSchema = z.object({
  importance: z.number().int().min(0).max(9),
})

const reflectionSchema = z.object({
  insights: z.array(z.object({
    insight: z.string().min(1),
    importance: z.number().int().min(0).max(9),
  })).min(1).max(5),
})

// --- Core Operations ---

/**
 * Record an observation — something the agent witnessed or experienced.
 * Automatically scores importance via LLM and checks reflection trigger.
 */
export async function observe(
  agentId: number,
  description: string,
  workspaceId: number = 1,
  relatedAgentId?: number,
): Promise<number> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Score importance via LLM (fast tier)
  let importance = 5 // default mid-range if LLM fails
  try {
    const response = await complete(
      [
        { role: 'system', content: 'Rate the importance/poignancy of this memory on a scale of 0-9. 0 is mundane (e.g. routine status check). 9 is critical (e.g. major failure, breakthrough). Return JSON: {"importance": N}' },
        { role: 'user', content: description },
      ],
      { agentId, workspaceId, taskType: 'importance-rating' },
    )
    const parsed = repairAndParse(response.text, importanceSchema)
    importance = parsed.importance
  } catch (err) {
    logger.warn({ err, agentId }, 'Failed to score memory importance, using default')
  }

  // Store the observation
  const result = db.prepare(
    `INSERT INTO agent_memories (agent_id, type, description, importance, last_access, related_agent_id, workspace_id, created_at)
     VALUES (?, 'observation', ?, ?, ?, ?, ?, ?)`
  ).run(agentId, description, importance, now, relatedAgentId ?? null, workspaceId, now)

  const memoryId = Number(result.lastInsertRowid)

  // Check reflection trigger
  const cumulative = db.prepare(
    `SELECT COALESCE(SUM(importance), 0) as total
     FROM agent_memories
     WHERE agent_id = ? AND workspace_id = ? AND type = 'observation'
       AND id > COALESCE((SELECT MAX(id) FROM agent_memories WHERE agent_id = ? AND type = 'reflection'), 0)`
  ).get(agentId, workspaceId, agentId) as { total: number }

  if (cumulative.total >= REFLECTION_THRESHOLD && !_reflectingAgents.has(agentId)) {
    // Trigger reflection asynchronously (don't block the observe call)
    _reflectingAgents.add(agentId)
    reflect(agentId, workspaceId)
      .catch((err) => {
        logger.error({ err, agentId }, 'Async reflection failed')
      })
      .finally(() => {
        _reflectingAgents.delete(agentId)
      })
  }

  return memoryId
}

/**
 * Record an observation without LLM scoring (for bulk imports or when LLM is unavailable).
 */
export function observeSync(
  agentId: number,
  description: string,
  importance: number,
  workspaceId: number = 1,
  relatedAgentId?: number,
): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const result = db.prepare(
    `INSERT INTO agent_memories (agent_id, type, description, importance, last_access, related_agent_id, workspace_id, created_at)
     VALUES (?, 'observation', ?, ?, ?, ?, ?, ?)`
  ).run(agentId, description, importance, now, relatedAgentId ?? null, workspaceId, now)

  return Number(result.lastInsertRowid)
}

/**
 * Recall memories relevant to a query.
 * Uses composite scoring: relevance + importance + recency.
 */
export function recall(
  agentId: number,
  query: string,
  workspaceId: number = 1,
  topK: number = DEFAULT_TOP_K,
): RecallResult[] {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Over-fetch by relevance (text matching via LIKE for now — FTS5 in future)
  const fetchLimit = topK * OVERFETCH_FACTOR
  const searchTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)

  let memories: AgentMemory[]
  if (searchTerms.length > 0) {
    // Escape LIKE wildcards in search terms
    const escapedTerms = searchTerms.map((t) => t.replace(/[%_\\]/g, '\\$&'))

    // Build a relevance-ranked query using LIKE with multiple terms
    const likeConditions = searchTerms.map(() => "LOWER(description) LIKE ? ESCAPE '\\'").join(' OR ')
    const likeParams = escapedTerms.map((t) => `%${t}%`)

    memories = db.prepare(
      `SELECT *, (${escapedTerms.map(() => `(CASE WHEN LOWER(description) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`).join(' + ')}) as match_count
       FROM agent_memories
       WHERE agent_id = ? AND workspace_id = ? AND (${likeConditions})
       ORDER BY match_count DESC, importance DESC
       LIMIT ?`
    ).all(
      ...likeParams, // for CASE expressions
      agentId, workspaceId,
      ...likeParams, // for WHERE conditions
      fetchLimit,
    ) as (AgentMemory & { match_count: number })[]
  } else {
    // No meaningful search terms — return by recency and importance
    memories = db.prepare(
      `SELECT * FROM agent_memories
       WHERE agent_id = ? AND workspace_id = ?
       ORDER BY last_access DESC, importance DESC
       LIMIT ?`
    ).all(agentId, workspaceId, fetchLimit) as AgentMemory[]
  }

  if (memories.length === 0) return []

  // Score each memory with composite formula
  const maxImportance = Math.max(...memories.map((m) => m.importance), 1)

  const scored: RecallResult[] = memories.map((m) => {
    // Relevance: proportion of query terms matched (0-1)
    const relevance = searchTerms.length > 0
      ? searchTerms.filter((t) => m.description.toLowerCase().includes(t)).length / searchTerms.length
      : 0.5

    // Importance: normalized 0-1
    const normalizedImportance = m.importance / maxImportance

    // Recency: exponential decay based on hours since last access
    const hoursSinceAccess = Math.max(0, (now - m.last_access) / 3600)
    const recency = Math.pow(RECENCY_DECAY, hoursSinceAccess)

    const score = relevance + normalizedImportance + recency

    return { ...m, score }
  })

  // Sort by composite score descending and take top K
  scored.sort((a, b) => b.score - a.score)
  const topResults = scored.slice(0, topK)

  // Update last_access on returned memories
  if (topResults.length > 0) {
    const ids = topResults.map((r) => r.id)
    db.prepare(
      `UPDATE agent_memories SET last_access = ? WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(now, ...ids)
  }

  return topResults
}

/**
 * Generate reflections — high-level insights from recent observations.
 * AI Town pattern: cumulative importance crosses threshold → generate 3 insights.
 */
export async function reflect(
  agentId: number,
  workspaceId: number = 1,
): Promise<number[]> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Get the last reflection id (if any) to scope recent observations
  const lastReflection = db.prepare(
    `SELECT MAX(id) as last_id FROM agent_memories WHERE agent_id = ? AND type = 'reflection'`
  ).get(agentId) as { last_id: number | null }

  const sinceId = lastReflection?.last_id ?? 0

  // Fetch recent observations since last reflection
  const recentMemories = db.prepare(
    `SELECT description, importance FROM agent_memories
     WHERE agent_id = ? AND workspace_id = ? AND type = 'observation' AND id > ?
     ORDER BY created_at DESC LIMIT 50`
  ).all(agentId, workspaceId, sinceId) as Array<{ description: string; importance: number }>

  if (recentMemories.length < 3) return []

  const memoryList = recentMemories
    .map((m, i) => `${i + 1}. [importance: ${m.importance}] ${m.description}`)
    .join('\n')

  const response = await complete(
    [
      {
        role: 'system',
        content: `You are an introspective agent. Given the following recent memories, generate 1-3 high-level insights or patterns you notice. Rate each insight's importance 0-9.
Return JSON: {"insights": [{"insight": "...", "importance": N}, ...]}`,
      },
      { role: 'user', content: memoryList },
    ],
    { agentId, workspaceId, taskType: 'memory-reflection' },
  )

  const parsed = repairAndParse(response.text, reflectionSchema)

  // Store each reflection
  const sourceIds = recentMemories.length > 0
    ? db.prepare(
        `SELECT id FROM agent_memories
         WHERE agent_id = ? AND workspace_id = ? AND type = 'observation' AND id > ?
         ORDER BY created_at DESC LIMIT 50`
      ).all(agentId, workspaceId, sinceId).map((r) => (r as { id: number }).id).join(',')
    : ''

  const reflectionIds: number[] = []
  for (const { insight, importance } of parsed.insights) {
    const result = db.prepare(
      `INSERT INTO agent_memories (agent_id, type, description, importance, last_access, source_memory_ids, workspace_id, created_at)
       VALUES (?, 'reflection', ?, ?, ?, ?, ?, ?)`
    ).run(agentId, insight, importance, now, sourceIds, workspaceId, now)

    reflectionIds.push(Number(result.lastInsertRowid))
  }

  logger.info({ agentId, count: reflectionIds.length }, 'Generated reflections')
  return reflectionIds
}

/**
 * Record or update a relationship memory between two agents.
 */
export function recordRelationship(
  agentId: number,
  targetAgentId: number,
  description: string,
  importance: number = 5,
  workspaceId: number = 1,
): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Check for existing relationship memory
  const existing = db.prepare(
    `SELECT id FROM agent_memories
     WHERE agent_id = ? AND related_agent_id = ? AND type = 'relationship' AND workspace_id = ?`
  ).get(agentId, targetAgentId, workspaceId) as { id: number } | undefined

  if (existing) {
    db.prepare(
      `UPDATE agent_memories SET description = ?, importance = ?, last_access = ? WHERE id = ?`
    ).run(description, importance, now, existing.id)
    return existing.id
  }

  const result = db.prepare(
    `INSERT INTO agent_memories (agent_id, type, description, importance, last_access, related_agent_id, workspace_id, created_at)
     VALUES (?, 'relationship', ?, ?, ?, ?, ?, ?)`
  ).run(agentId, description, importance, now, targetAgentId, workspaceId, now)

  return Number(result.lastInsertRowid)
}

/**
 * Consolidate a batch of episodic memories into one semantic summary.
 * TinyTroupe pattern: summarize recent events at episode boundaries.
 */
export async function consolidateEpisode(
  agentId: number,
  memoryIds: number[],
  workspaceId: number = 1,
): Promise<number> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  if (memoryIds.length === 0) throw new Error('No memory IDs to consolidate')

  const placeholders = memoryIds.map(() => '?').join(',')
  const memories = db.prepare(
    `SELECT description, importance FROM agent_memories
     WHERE id IN (${placeholders}) AND agent_id = ? AND workspace_id = ?
     ORDER BY created_at ASC`
  ).all(...memoryIds, agentId, workspaceId) as Array<{ description: string; importance: number }>

  if (memories.length === 0) throw new Error('No matching memories found')

  const memoryText = memories.map((m) => `- ${m.description}`).join('\n')

  const response = await complete(
    [
      {
        role: 'system',
        content: 'Summarize the following sequence of events into one concise paragraph that captures the key outcomes and learnings. Return only the summary text, no JSON.',
      },
      { role: 'user', content: memoryText },
    ],
    { agentId, workspaceId, taskType: 'summarization' },
  )

  const avgImportance = Math.round(
    memories.reduce((sum, m) => sum + m.importance, 0) / memories.length
  )

  const result = db.prepare(
    `INSERT INTO agent_memories (agent_id, type, description, importance, last_access, source_memory_ids, workspace_id, created_at)
     VALUES (?, 'reflection', ?, ?, ?, ?, ?, ?)`
  ).run(agentId, response.text.trim(), avgImportance, now, memoryIds.join(','), workspaceId, now)

  return Number(result.lastInsertRowid)
}

/**
 * Get a timeline view of agent memories.
 */
export function getTimeline(
  agentId: number,
  workspaceId: number = 1,
  options: { type?: string; limit?: number; offset?: number } = {},
): AgentMemory[] {
  const db = getDatabase()
  const { type, limit = 50, offset = 0 } = options

  if (type) {
    return db.prepare(
      `SELECT * FROM agent_memories
       WHERE agent_id = ? AND workspace_id = ? AND type = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(agentId, workspaceId, type, limit, offset) as AgentMemory[]
  }

  return db.prepare(
    `SELECT * FROM agent_memories
     WHERE agent_id = ? AND workspace_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(agentId, workspaceId, limit, offset) as AgentMemory[]
}

/**
 * Get memory statistics for an agent.
 */
export function getMemoryStats(
  agentId: number,
  workspaceId: number = 1,
): { total: number; observations: number; reflections: number; relationships: number; avgImportance: number } {
  const db = getDatabase()

  const stats = db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN type = 'observation' THEN 1 ELSE 0 END) as observations,
       SUM(CASE WHEN type = 'reflection' THEN 1 ELSE 0 END) as reflections,
       SUM(CASE WHEN type = 'relationship' THEN 1 ELSE 0 END) as relationships,
       COALESCE(AVG(importance), 0) as avgImportance
     FROM agent_memories
     WHERE agent_id = ? AND workspace_id = ?`
  ).get(agentId, workspaceId) as {
    total: number
    observations: number
    reflections: number
    relationships: number
    avgImportance: number
  }

  return stats
}

/**
 * Generate a text hash for embedding caching.
 */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** Check if an agent is currently reflecting (for testing). */
export function isReflecting(agentId: number): boolean {
  return _reflectingAgents.has(agentId)
}
