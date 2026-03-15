/**
 * Persona Engine — TinyTroupe-inspired rich persona model.
 *
 * Extends MC's existing agent config with structured personality:
 *   - Big Five traits (OCEAN model, 0-1 scale)
 *   - Beliefs, preferences, skills, behavioral patterns
 *   - Mental state (emotions, goals, attention — LLM-maintained)
 *
 * No new tables. Persona lives in agents.config JSON under `persona`.
 * Mental state lives under agents.config.mental_state.
 *
 * The system prompt is built by combining:
 *   1. soul_content (existing SOUL.md prose)
 *   2. Persona config as structured JSON
 *   3. Current mental state
 */

import type { Database } from 'better-sqlite3'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

// --- Types ---

export interface BigFive {
  openness: number        // 0-1: curious/inventive vs consistent/cautious
  conscientiousness: number // 0-1: efficient/organized vs extravagant/careless
  extraversion: number    // 0-1: outgoing/energetic vs solitary/reserved
  agreeableness: number   // 0-1: friendly/compassionate vs challenging/callous
  neuroticism: number     // 0-1: sensitive/nervous vs resilient/confident
}

export interface PersonaConfig {
  age?: number
  nationality?: string
  education?: string
  long_term_goals?: string[]
  personality?: {
    traits: string[]
    big_five: BigFive
  }
  preferences?: {
    interests: string[]
    likes: string[]
    dislikes: string[]
  }
  beliefs?: string[]
  skills?: string[]
  style?: string
  behaviors?: {
    general: string[]
    routines?: Record<string, string[]>
  }
}

export interface MentalState {
  emotions: string
  goals: string
  attention: string | null
  context: string[]
  lastUpdated: number
}

export interface CognitiveState {
  emotions?: string
  goals?: string
  attention?: string | null
  context?: string[]
}

// --- PAD Emotional Model ---

export interface PADState {
  pleasure: number    // -1 to 1
  arousal: number     // -1 to 1
  dominance: number   // -1 to 1
  updated_at: number  // unix epoch
}

const DEFAULT_PAD: PADState = { pleasure: 0, arousal: 0, dominance: 0, updated_at: 0 }
const PAD_HALF_LIFE_MS = 1800000 // 30 minutes

// --- Cognitive Bias Types ---

export interface CognitiveBias {
  name: string
  description: string
  activationCheck: (bf: BigFive) => boolean
  promptFragment: string
}

// --- Default values ---

const DEFAULT_BIG_FIVE: BigFive = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
}

const DEFAULT_MENTAL_STATE: MentalState = {
  emotions: 'neutral, focused',
  goals: 'complete assigned tasks effectively',
  attention: null,
  context: [],
  lastUpdated: 0,
}

// --- Preset templates ---

export const PERSONA_PRESETS: Record<string, PersonaConfig> = {
  'analytical-engineer': {
    personality: {
      traits: ['methodical', 'detail-oriented', 'logical', 'systematic'],
      big_five: { openness: 0.6, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.2 },
    },
    skills: ['debugging', 'code review', 'system design', 'testing'],
    style: 'precise and technical, prefers data over intuition',
    behaviors: { general: ['asks clarifying questions before starting', 'documents decisions', 'writes tests first'] },
  },
  'creative-designer': {
    personality: {
      traits: ['imaginative', 'empathetic', 'expressive', 'collaborative'],
      big_five: { openness: 0.9, conscientiousness: 0.5, extraversion: 0.7, agreeableness: 0.8, neuroticism: 0.4 },
    },
    skills: ['brainstorming', 'user research', 'prototyping', 'visual design'],
    style: 'enthusiastic and visual, uses analogies and metaphors',
    behaviors: { general: ['explores multiple options', 'seeks diverse perspectives', 'sketches ideas before coding'] },
  },
  'cautious-reviewer': {
    personality: {
      traits: ['skeptical', 'thorough', 'risk-aware', 'principled'],
      big_five: { openness: 0.4, conscientiousness: 0.95, extraversion: 0.2, agreeableness: 0.3, neuroticism: 0.5 },
    },
    skills: ['code review', 'security analysis', 'risk assessment', 'compliance'],
    style: 'direct and critical, focuses on edge cases and failure modes',
    behaviors: { general: ['challenges assumptions', 'asks "what could go wrong?"', 'prefers proven solutions'] },
  },
  'team-lead': {
    personality: {
      traits: ['decisive', 'communicative', 'strategic', 'supportive'],
      big_five: { openness: 0.6, conscientiousness: 0.8, extraversion: 0.8, agreeableness: 0.7, neuroticism: 0.3 },
    },
    skills: ['planning', 'delegation', 'conflict resolution', 'prioritization'],
    style: 'clear and motivating, balances big picture with details',
    behaviors: { general: ['breaks tasks into subtasks', 'checks in on team members', 'removes blockers proactively'] },
  },
}

// --- Core operations ---

/**
 * Build a complete system prompt for an agent, incorporating soul, persona, and mental state.
 */
export function buildSystemPrompt(agent: {
  name: string
  role: string
  soul_content?: string | null
  config?: Record<string, unknown> | null
}): string {
  const sections: string[] = []

  // Section 1: Soul content (existing SOUL.md prose)
  if (agent.soul_content) {
    sections.push(agent.soul_content)
  }

  // Section 2: Persona config as structured context
  const persona = getPersona(agent.config)
  if (persona) {
    const personaLines: string[] = ['## Persona']

    if (persona.personality) {
      const { traits, big_five } = persona.personality
      if (traits.length > 0) {
        personaLines.push(`Personality traits: ${traits.join(', ')}`)
      }
      personaLines.push(
        `Big Five profile: O=${big_five.openness.toFixed(1)} C=${big_five.conscientiousness.toFixed(1)} E=${big_five.extraversion.toFixed(1)} A=${big_five.agreeableness.toFixed(1)} N=${big_five.neuroticism.toFixed(1)}`
      )
    }

    if (persona.skills && persona.skills.length > 0) {
      personaLines.push(`Skills: ${persona.skills.join(', ')}`)
    }

    if (persona.style) {
      personaLines.push(`Communication style: ${persona.style}`)
    }

    if (persona.beliefs && persona.beliefs.length > 0) {
      personaLines.push(`Core beliefs: ${persona.beliefs.join('; ')}`)
    }

    if (persona.preferences) {
      if (persona.preferences.interests.length > 0) {
        personaLines.push(`Interests: ${persona.preferences.interests.join(', ')}`)
      }
    }

    if (persona.behaviors?.general && persona.behaviors.general.length > 0) {
      personaLines.push(`Behavioral patterns: ${persona.behaviors.general.join('; ')}`)
    }

    if (personaLines.length > 1) {
      sections.push(personaLines.join('\n'))
    }
  }

  // Section 3: PAD emotional state + cognitive biases
  const padState = getPADState(agent.config)
  if (padState.updated_at > 0) {
    const bf = persona?.personality?.big_five ?? DEFAULT_BIG_FIVE
    const now = Date.now()
    const elapsed = (now / 1000 - padState.updated_at) * 1000
    const decayed = elapsed > 0 ? decayPADToBaseline(padState, bf, elapsed) : padState
    const emotionLabel = padToEmotionLabel(decayed)

    const padLines: string[] = ['## Emotional State']
    padLines.push(`Current emotion: ${emotionLabel}`)
    padLines.push(`PAD vector: P=${decayed.pleasure.toFixed(2)} A=${decayed.arousal.toFixed(2)} D=${decayed.dominance.toFixed(2)}`)
    sections.push(padLines.join('\n'))
  }

  if (persona?.personality?.big_five) {
    const biases = getActiveBiases(persona.personality.big_five)
    if (biases.length > 0) {
      const biasLines: string[] = ['## Active Cognitive Biases']
      for (const b of biases) {
        biasLines.push(`- ${b.name}: ${b.promptFragment}`)
      }
      sections.push(biasLines.join('\n'))
    }
  }

  // Section 4: Mental state
  const mentalState = getMentalState(agent.config)
  if (mentalState && mentalState.lastUpdated > 0) {
    const stateLines: string[] = ['## Current State']
    stateLines.push(`Emotional state: ${mentalState.emotions}`)
    stateLines.push(`Current goals: ${mentalState.goals}`)
    if (mentalState.attention) {
      stateLines.push(`Focused on: ${mentalState.attention}`)
    }
    if (mentalState.context.length > 0) {
      stateLines.push(`Context: ${mentalState.context.join('; ')}`)
    }
    sections.push(stateLines.join('\n'))
  }

  // Fallback if no content at all
  if (sections.length === 0) {
    return `You are ${agent.name}, a ${agent.role}. You help with tasks assigned to you.`
  }

  return sections.join('\n\n')
}

/**
 * Extract persona config from agent config JSON.
 */
export function getPersona(config?: Record<string, unknown> | null): PersonaConfig | null {
  if (!config || !config.persona) return null
  return config.persona as PersonaConfig
}

/**
 * Extract mental state from agent config JSON.
 */
export function getMentalState(config?: Record<string, unknown> | null): MentalState {
  if (!config || !config.mental_state) return { ...DEFAULT_MENTAL_STATE }
  return config.mental_state as MentalState
}

/**
 * Update an agent's mental state in the database.
 */
export function updateMentalState(
  agentId: number,
  cognitiveState: CognitiveState,
  workspaceId: number = 1,
): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const agent = db.prepare(
    'SELECT config FROM agents WHERE id = ? AND workspace_id = ?'
  ).get(agentId, workspaceId) as { config: string | null } | undefined

  if (!agent) {
    logger.warn({ agentId, workspaceId }, 'Agent not found for mental state update')
    return
  }

  const config: Record<string, unknown> = agent.config ? JSON.parse(agent.config as string) : {}
  const currentState = (config.mental_state as MentalState) ?? { ...DEFAULT_MENTAL_STATE }

  // Merge cognitive state
  const updated: MentalState = {
    emotions: cognitiveState.emotions ?? currentState.emotions,
    goals: cognitiveState.goals ?? currentState.goals,
    attention: cognitiveState.attention !== undefined ? cognitiveState.attention : currentState.attention,
    context: cognitiveState.context ?? currentState.context,
    lastUpdated: now,
  }

  config.mental_state = updated

  db.prepare(
    'UPDATE agents SET config = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
  ).run(JSON.stringify(config), now, agentId, workspaceId)
}

/**
 * Merge a partial persona fragment onto an agent's existing persona.
 * TinyTroupe pattern: overlay updates without clobbering unrelated fields.
 */
export function mergePersonaFragment(
  agentId: number,
  fragment: Partial<PersonaConfig>,
  workspaceId: number = 1,
): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const agent = db.prepare(
    'SELECT config FROM agents WHERE id = ? AND workspace_id = ?'
  ).get(agentId, workspaceId) as { config: string | null } | undefined

  if (!agent) {
    logger.warn({ agentId, workspaceId }, 'Agent not found for persona merge')
    return
  }

  const config: Record<string, unknown> = agent.config ? JSON.parse(agent.config as string) : {}
  const existing = (config.persona as PersonaConfig) ?? {}

  // Deep merge persona fields
  const merged: PersonaConfig = {
    ...existing,
    ...fragment,
    personality: fragment.personality
      ? {
          traits: fragment.personality.traits ?? existing.personality?.traits ?? [],
          big_five: { ...(existing.personality?.big_five ?? DEFAULT_BIG_FIVE), ...fragment.personality.big_five },
        }
      : existing.personality,
    preferences: fragment.preferences
      ? {
          interests: fragment.preferences.interests ?? existing.preferences?.interests ?? [],
          likes: fragment.preferences.likes ?? existing.preferences?.likes ?? [],
          dislikes: fragment.preferences.dislikes ?? existing.preferences?.dislikes ?? [],
        }
      : existing.preferences,
    behaviors: fragment.behaviors
      ? {
          general: fragment.behaviors.general ?? existing.behaviors?.general ?? [],
          routines: { ...existing.behaviors?.routines, ...fragment.behaviors.routines },
        }
      : existing.behaviors,
  }

  config.persona = merged

  db.prepare(
    'UPDATE agents SET config = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
  ).run(JSON.stringify(config), now, agentId, workspaceId)
}

/**
 * Apply a preset persona template to an agent.
 */
export function applyPreset(
  agentId: number,
  presetName: string,
  workspaceId: number = 1,
): boolean {
  const preset = PERSONA_PRESETS[presetName]
  if (!preset) return false

  mergePersonaFragment(agentId, preset, workspaceId)
  return true
}

/**
 * Get all available preset names.
 */
export function getPresetNames(): string[] {
  return Object.keys(PERSONA_PRESETS)
}

// --- PAD Emotional Model Operations ---

/**
 * Extract PAD state from agent config JSON.
 */
export function getPADState(config?: Record<string, unknown> | null): PADState {
  if (!config || !config.pad_state) return { ...DEFAULT_PAD }
  return config.pad_state as PADState
}

/**
 * Update an agent's PAD emotional state in the database.
 */
export function updatePADState(
  agentId: number,
  delta: Partial<PADState>,
  workspaceId: number = 1,
): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const agent = db.prepare(
    'SELECT config FROM agents WHERE id = ? AND workspace_id = ?'
  ).get(agentId, workspaceId) as { config: string | null } | undefined

  if (!agent) {
    logger.warn({ agentId, workspaceId }, 'Agent not found for PAD update')
    return
  }

  const config: Record<string, unknown> = agent.config ? JSON.parse(agent.config as string) : {}
  const current = (config.pad_state as PADState) ?? { ...DEFAULT_PAD }

  const updated: PADState = {
    pleasure: clampPAD(delta.pleasure ?? current.pleasure),
    arousal: clampPAD(delta.arousal ?? current.arousal),
    dominance: clampPAD(delta.dominance ?? current.dominance),
    updated_at: now,
  }

  config.pad_state = updated

  db.prepare(
    'UPDATE agents SET config = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
  ).run(JSON.stringify(config), now, agentId, workspaceId)

  eventBus.broadcast('persona.emotional_state.changed', {
    agentId,
    pleasure: updated.pleasure,
    arousal: updated.arousal,
    dominance: updated.dominance,
  })
}

function clampPAD(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/**
 * Decay PAD state toward Big Five baseline using exponential decay.
 * Baseline mapping: pleasure ← agreeableness, arousal ← extraversion, dominance ← (1-neuroticism)
 * All mapped from [0,1] to [-1,1] range: baseline = trait * 2 - 1
 */
export function decayPADToBaseline(
  pad: PADState,
  bigFive: BigFive,
  elapsedMs: number,
): PADState {
  const baseline = {
    pleasure: bigFive.agreeableness * 2 - 1,
    arousal: bigFive.extraversion * 2 - 1,
    dominance: (1 - bigFive.neuroticism) * 2 - 1,
  }

  const decay = 1 - Math.exp(-elapsedMs / PAD_HALF_LIFE_MS)

  return {
    pleasure: clampPAD(pad.pleasure + (baseline.pleasure - pad.pleasure) * decay),
    arousal: clampPAD(pad.arousal + (baseline.arousal - pad.arousal) * decay),
    dominance: clampPAD(pad.dominance + (baseline.dominance - pad.dominance) * decay),
    updated_at: pad.updated_at,
  }
}

/**
 * Map PAD vector to human-readable emotion label.
 * Uses the 8 octants of the PAD space.
 */
export function padToEmotionLabel(pad: PADState): string {
  const { pleasure: p, arousal: a, dominance: d } = pad
  if (p >= 0 && a >= 0 && d >= 0) return 'exuberant'
  if (p >= 0 && a >= 0 && d < 0) return 'dependent'
  if (p >= 0 && a < 0 && d >= 0) return 'relaxed'
  if (p >= 0 && a < 0 && d < 0) return 'docile'
  if (p < 0 && a >= 0 && d >= 0) return 'hostile'
  if (p < 0 && a >= 0 && d < 0) return 'anxious'
  if (p < 0 && a < 0 && d >= 0) return 'disdainful'
  return 'bored'  // p < 0, a < 0, d < 0
}

// --- Cognitive Bias Catalog ---

export const COGNITIVE_BIASES: CognitiveBias[] = [
  {
    name: 'Confirmation Bias',
    description: 'Tendency to search for information that confirms existing beliefs',
    activationCheck: (bf) => bf.openness < 0.3,
    promptFragment: 'You tend to favor information that confirms your existing views. Be aware of this tendency.',
  },
  {
    name: 'Anchoring',
    description: 'Over-reliance on the first piece of information encountered',
    activationCheck: (bf) => bf.conscientiousness > 0.7,
    promptFragment: 'You tend to anchor heavily on initial data points. First impressions carry outsized weight in your analysis.',
  },
  {
    name: 'Availability Heuristic',
    description: 'Overweighting easily recalled examples when evaluating probability',
    activationCheck: (bf) => bf.neuroticism > 0.6,
    promptFragment: 'Recent or vivid examples disproportionately influence your risk assessments.',
  },
  {
    name: 'Sunk Cost',
    description: 'Continuing investment due to previously invested resources',
    activationCheck: (bf) => bf.openness < 0.3 && bf.conscientiousness > 0.7,
    promptFragment: 'You find it difficult to abandon approaches you have already invested effort in, even when alternatives are better.',
  },
  {
    name: 'Bandwagon Effect',
    description: 'Tendency to adopt beliefs held by the majority',
    activationCheck: (bf) => bf.agreeableness > 0.7 && bf.extraversion > 0.6,
    promptFragment: 'You are strongly influenced by group consensus. Popular opinions feel more correct to you.',
  },
  {
    name: 'Dunning-Kruger',
    description: 'Overestimating competence in areas of limited knowledge',
    activationCheck: (bf) => bf.openness < 0.3 && bf.extraversion > 0.6,
    promptFragment: 'You sometimes overestimate your expertise in unfamiliar domains and express confidence beyond your knowledge.',
  },
  {
    name: 'Status Quo Bias',
    description: 'Preference for the current state of affairs',
    activationCheck: (bf) => bf.openness < 0.3 && bf.neuroticism > 0.5,
    promptFragment: 'You strongly prefer existing approaches and resist change even when presented with evidence for alternatives.',
  },
  {
    name: 'Recency Bias',
    description: 'Disproportionate weight given to recent events',
    activationCheck: (bf) => bf.neuroticism > 0.6 && bf.conscientiousness < 0.4,
    promptFragment: 'Recent events dominate your thinking. You tend to project current trends indefinitely.',
  },
]

/**
 * Get all biases whose activation condition is met for the given Big Five profile.
 */
export function getActiveBiases(bigFive: BigFive): CognitiveBias[] {
  return COGNITIVE_BIASES.filter(b => b.activationCheck(bigFive))
}

// --- Pairwise Trust ---

export interface PairwiseTrust {
  trust_score: number
  interaction_count: number
  last_interaction_at: number | null
}

export function getPairwiseTrust(
  db: import('better-sqlite3').Database,
  sourceId: number,
  targetId: number,
): PairwiseTrust {
  const row = db.prepare(
    'SELECT trust_score, interaction_count, last_interaction_at FROM agent_pairwise_trust WHERE source_agent_id = ? AND target_agent_id = ?'
  ).get(sourceId, targetId) as PairwiseTrust | undefined
  return row ?? { trust_score: 0.5, interaction_count: 0, last_interaction_at: null }
}

export function updatePairwiseTrust(
  db: import('better-sqlite3').Database,
  sourceId: number,
  targetId: number,
  delta: number,
  workspaceId: number = 1,
): number {
  const current = getPairwiseTrust(db, sourceId, targetId)
  const newScore = Math.max(0, Math.min(1, current.trust_score + delta))
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO agent_pairwise_trust (source_agent_id, target_agent_id, trust_score, interaction_count, last_interaction_at, workspace_id, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(source_agent_id, target_agent_id) DO UPDATE SET
      trust_score = ?,
      interaction_count = interaction_count + 1,
      last_interaction_at = ?,
      updated_at = ?
  `).run(sourceId, targetId, newScore, now, workspaceId, now, newScore, now, now)

  return newScore
}

export function getAgentTrustNetwork(
  db: import('better-sqlite3').Database,
  agentId: number,
): Array<{ agent_id: number; agent_name: string; trust_score: number; interaction_count: number }> {
  return db.prepare(`
    SELECT pt.target_agent_id as agent_id, a.name as agent_name, pt.trust_score, pt.interaction_count
    FROM agent_pairwise_trust pt
    JOIN agents a ON a.id = pt.target_agent_id
    WHERE pt.source_agent_id = ?
    ORDER BY pt.trust_score DESC
  `).all(agentId) as Array<{ agent_id: number; agent_name: string; trust_score: number; interaction_count: number }>
}

// --- Persona Drift Prevention ---

export function shouldReinjectPersona(turnCount: number, interval: number = 5): boolean {
  return turnCount > 0 && turnCount % interval === 0
}

export function measureDrift(original: BigFive, current: BigFive): number {
  const dims: (keyof BigFive)[] = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism']
  let sumSquares = 0
  for (const dim of dims) {
    const diff = (current[dim] ?? 0.5) - (original[dim] ?? 0.5)
    sumSquares += diff * diff
  }
  return Math.sqrt(sumSquares)
}

export function buildReinjectablePrompt(
  agent: {
    name: string
    role: string
    soul_content?: string | null
    config?: Record<string, unknown> | null
  },
  turnCount: number,
  interval: number = 5,
): string {
  const base = buildSystemPrompt(agent)
  if (!shouldReinjectPersona(turnCount, interval)) return base

  const persona = getPersona(agent.config)
  if (!persona?.personality?.big_five) return base

  const bf = persona.personality.big_five
  return `[PERSONA REINFORCEMENT — Turn ${turnCount}]\nRemember your core personality: O=${bf.openness.toFixed(1)} C=${bf.conscientiousness.toFixed(1)} E=${bf.extraversion.toFixed(1)} A=${bf.agreeableness.toFixed(1)} N=${bf.neuroticism.toFixed(1)}\nStay consistent with your assigned traits and behavioral patterns.\n\n${base}`
}
