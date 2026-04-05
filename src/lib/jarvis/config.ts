/** JARVIS voice assistant configuration */

const DEFAULT_JARVIS_HOST = 'localhost'
const DEFAULT_JARVIS_PORT = 8340

export function getJarvisBaseUrl(): string {
  const host = process.env.JARVIS_HOST ?? DEFAULT_JARVIS_HOST
  const port = process.env.JARVIS_PORT ?? DEFAULT_JARVIS_PORT
  return `http://${host}:${port}`
}

export function isJarvisEnabled(): boolean {
  return process.env.JARVIS_ENABLED === 'true'
}

/** Client-side check — uses NEXT_PUBLIC_ prefix so it's available in the browser */
export function isJarvisEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_JARVIS_ENABLED === 'true'
}

/**
 * Build the WebSocket URL for the client.
 * Auto-detects wss:// when the page is served over HTTPS for production safety.
 * Override entirely with NEXT_PUBLIC_JARVIS_WS_URL for custom deployments.
 */
export function getJarvisWsUrl(): string {
  if (process.env.NEXT_PUBLIC_JARVIS_WS_URL) {
    return process.env.NEXT_PUBLIC_JARVIS_WS_URL
  }
  const host = process.env.NEXT_PUBLIC_JARVIS_HOST ?? DEFAULT_JARVIS_HOST
  const port = process.env.NEXT_PUBLIC_JARVIS_PORT ?? DEFAULT_JARVIS_PORT
  // Use wss:// when served over HTTPS (e.g. production), ws:// for local dev
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss'
      : 'ws'
  return `${protocol}://${host}:${port}`
}

/**
 * Auth token for the Jarvis WebSocket — passed as ?token= query param.
 * Falls back to NEXT_PUBLIC_JARVIS_AUTH_TOKEN if set directly in env.
 * In most deployments the token is fetched via fetchJarvisAuthToken() instead.
 */
export function getJarvisAuthToken(): string {
  return process.env.NEXT_PUBLIC_JARVIS_AUTH_TOKEN ?? ''
}

/**
 * Fetch the Jarvis auth token from the Ultron server-side API.
 * Resolves the token that Jarvis auto-generated in src/jarvis/.env on first run.
 * Returns empty string on failure so the caller can handle gracefully.
 */
export async function fetchJarvisAuthToken(): Promise<string> {
  // In SSR context there's no window — skip
  if (typeof window === 'undefined') return ''
  // Fast path: token already baked into build
  const baked = process.env.NEXT_PUBLIC_JARVIS_AUTH_TOKEN
  if (baked) return baked
  try {
    const res = await fetch('/api/jarvis/token', { credentials: 'include', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return ''
    const data = await res.json() as { token?: string }
    return data.token ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Voice Persona Configuration
// ---------------------------------------------------------------------------

/**
 * WHY: Each C-Suite agent has a distinct communication style. Voice personas
 * encode these differences for TTS output, creating an immersive multi-agent
 * experience without requiring GPU-based voice synthesis models.
 * Inspired by NVIDIA PersonaPlex's persona embedding concept, re-implemented
 * in TypeScript using standard TTS provider parameters.
 */
export interface VoicePersona {
  readonly agentId: string
  readonly voiceId: string        // TTS provider voice ID
  readonly pitchShift: number     // -1.0 (lower) to 1.0 (higher), 0.0 = neutral
  readonly speedMultiplier: number // 0.5 (slow) to 2.0 (fast), 1.0 = normal
  readonly personality: string    // text description used for prompt prefix
  readonly formality: 'formal' | 'technical' | 'strategic' | 'casual'
}

// Default fallback persona for unknown agents
const DEFAULT_PERSONA: VoicePersona = {
  agentId: 'default',
  voiceId: 'nova',
  pitchShift: 0.0,
  speedMultiplier: 1.0,
  personality: 'Professional AI assistant',
  formality: 'formal',
}

export const AGENT_VOICE_MAP: ReadonlyMap<string, VoicePersona> = new Map([
  ['ultron',       { agentId: 'ultron',       voiceId: 'onyx',    pitchShift: -0.3,  speedMultiplier: 0.9,  personality: 'Supreme Commander with gravitas and authority',      formality: 'formal'    }],
  ['cso-venture',  { agentId: 'cso-venture',  voiceId: 'shimmer', pitchShift: 0.1,   speedMultiplier: 1.1,  personality: 'Strategic visionary focused on growth',              formality: 'strategic'  }],
  ['cfo-ledger',   { agentId: 'cfo-ledger',   voiceId: 'echo',    pitchShift: -0.1,  speedMultiplier: 0.95, personality: 'Precise financial analyst with measured cadence',    formality: 'formal'    }],
  ['cto-omega',    { agentId: 'cto-omega',    voiceId: 'alloy',   pitchShift: 0.0,   speedMultiplier: 1.05, personality: 'Technical architect speaking with precision',         formality: 'technical' }],
  ['cio-alpha',    { agentId: 'cio-alpha',    voiceId: 'fable',   pitchShift: 0.0,   speedMultiplier: 1.0,  personality: 'Systems thinker with methodical delivery',           formality: 'technical' }],
  ['cmo-nexus',    { agentId: 'cmo-nexus',    voiceId: 'nova',    pitchShift: 0.2,   speedMultiplier: 1.15, personality: 'Energetic marketing strategist',                     formality: 'casual'    }],
  ['clo-relay',    { agentId: 'clo-relay',    voiceId: 'echo',    pitchShift: -0.05, speedMultiplier: 0.9,  personality: 'Legal counsel with deliberate authority',            formality: 'formal'    }],
  ['coo-prime',    { agentId: 'coo-prime',    voiceId: 'alloy',   pitchShift: -0.1,  speedMultiplier: 1.0,  personality: 'Operations director with clear directives',          formality: 'formal'    }],
  ['cao-sentinel', { agentId: 'cao-sentinel', voiceId: 'onyx',    pitchShift: -0.2,  speedMultiplier: 0.85, personality: 'Risk auditor with cautious deliberation',            formality: 'formal'    }],
  ['cdo-prism',    { agentId: 'cdo-prism',    voiceId: 'shimmer', pitchShift: 0.15,  speedMultiplier: 1.1,  personality: 'Data visionary excited by insights',                 formality: 'strategic' }],
])

/**
 * Returns the voice persona for a given agent ID.
 * Falls back to the default persona for unknown agents.
 */
export function getVoicePersona(agentId: string): VoicePersona {
  return AGENT_VOICE_MAP.get(agentId) ?? DEFAULT_PERSONA
}

/**
 * Applies persona formality markers to text for TTS pre-processing.
 * WHY: Different formality levels require different text transformations
 * to sound natural in each agent's voice — e.g. formal agents avoid
 * contractions, technical agents prefer terse sentences.
 */
export function applyVoicePersona(persona: VoicePersona, text: string): string {
  if (persona.formality === 'technical') {
    // Technical personas speak in shorter, more precise sentences
    return text.replace(/\s{2,}/g, ' ').trim()
  }
  if (persona.formality === 'formal') {
    // Formal personas avoid contractions
    return text
      .replace(/\bcan't\b/g, 'cannot')
      .replace(/\bwon't\b/g, 'will not')
      .replace(/\bdon't\b/g, 'do not')
      .replace(/\bit's\b/g, 'it is')
      .trim()
  }
  return text.trim()
}
