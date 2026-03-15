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

import { getDatabase } from '@/lib/db'
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

  // Section 3: Mental state
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
