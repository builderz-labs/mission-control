import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { applyAgentAlias, unaliasAgentForRuntime } from './identity-alias'

export interface GatewaySession {
  /** Session store key, e.g. "agent:<agent>:main" */
  key: string
  /** Agent directory name, e.g. "<agent>" */
  agent: string
  sessionId: string
  updatedAt: number
  chatType: string
  channel: string
  model: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  contextTokens: number
  active: boolean
}

let cachedAllowedRuntimeAgents: { value: Set<string>; loadedAt: number } | null = null

function getAllowedRuntimeAgents(): Set<string> {
  const now = Date.now()
  if (cachedAllowedRuntimeAgents && now - cachedAllowedRuntimeAgents.loadedAt < 60_000) {
    return cachedAllowedRuntimeAgents.value
  }

  const allowed = new Set<string>()
  const openclawHome = config.openclawHome
  if (openclawHome) {
    try {
      const configPath = path.join(openclawHome, 'openclaw.json')
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const list = parsed?.agents?.list || []
      for (const item of list) {
        if (typeof item?.id === 'string' && item.id.trim()) {
          allowed.add(item.id.trim())
        }
      }
    } catch {
      // ignore, fallback below
    }
  }

  // Always allow runtime identity behind Nova alias (main) and Nova logical id
  allowed.add(unaliasAgentForRuntime('nova'))
  allowed.add('nova')

  cachedAllowedRuntimeAgents = { value: allowed, loadedAt: now }
  return allowed
}

/**
 * Read all sessions from OpenClaw agent session stores on disk.
 *
 * OpenClaw stores sessions per-agent at:
 *   {OPENCLAW_HOME}/agents/{agentName}/sessions/sessions.json
 *
 * Each file is a JSON object keyed by session key (e.g. "agent:<agent>:main")
 * with session metadata as values.
 */
export function getAllGatewaySessions(activeWithinMs = 60 * 60 * 1000): GatewaySession[] {
  const openclawHome = config.openclawHome
  if (!openclawHome) return []

  const agentsDir = path.join(openclawHome, 'agents')
  if (!fs.existsSync(agentsDir)) return []

  const sessions: GatewaySession[] = []
  const now = Date.now()
  const allowedRuntimeAgents = getAllowedRuntimeAgents()
  const includeUnknown = (process.env.MC_INCLUDE_UNKNOWN_SESSION_AGENTS ?? 'false') === 'true'

  let agentDirs: string[]
  try {
    agentDirs = fs.readdirSync(agentsDir)
  } catch {
    return []
  }

  for (const agentName of agentDirs) {
    if (!includeUnknown && !allowedRuntimeAgents.has(agentName)) {
      continue
    }

    const sessionsFile = path.join(agentsDir, agentName, 'sessions', 'sessions.json')
    try {
      if (!fs.statSync(sessionsFile).isFile()) continue
      const raw = fs.readFileSync(sessionsFile, 'utf-8')
      const data = JSON.parse(raw)

      for (const [key, entry] of Object.entries(data)) {
        const s = entry as Record<string, any>
        const updatedAt = s.updatedAt || 0
        sessions.push({
          key,
          agent: applyAgentAlias(agentName),
          sessionId: s.sessionId || '',
          updatedAt,
          chatType: s.chatType || 'unknown',
          channel: s.deliveryContext?.channel || s.lastChannel || s.channel || '',
          model: s.model || '',
          totalTokens: s.totalTokens || 0,
          inputTokens: s.inputTokens || 0,
          outputTokens: s.outputTokens || 0,
          contextTokens: s.contextTokens || 0,
          active: (now - updatedAt) < activeWithinMs,
        })
      }
    } catch {
      // Skip agents without valid session files
    }
  }

  // Sort by most recently updated first
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return sessions
}

/**
 * Derive agent active/idle/offline status from their sessions.
 * Returns a map of agentName -> { status, lastActivity, channel }
 */
export function getAgentLiveStatuses(): Map<string, {
  status: 'active' | 'idle' | 'offline'
  lastActivity: number
  channel: string
}> {
  const sessions = getAllGatewaySessions()
  const now = Date.now()
  const statuses = new Map<string, { status: 'active' | 'idle' | 'offline'; lastActivity: number; channel: string }>()

  for (const session of sessions) {
    const existing = statuses.get(session.agent)
    // Keep the most recent session per agent
    if (!existing || session.updatedAt > existing.lastActivity) {
      const age = now - session.updatedAt
      let status: 'active' | 'idle' | 'offline'
      if (age < 5 * 60 * 1000) {
        status = 'active'       // Active within 5 minutes
      } else if (age < 60 * 60 * 1000) {
        status = 'idle'         // Active within 1 hour
      } else {
        status = 'offline'
      }
      statuses.set(session.agent, {
        status,
        lastActivity: session.updatedAt,
        channel: session.channel,
      })
    }
  }

  return statuses
}
