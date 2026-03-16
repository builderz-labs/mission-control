import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'

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

function getGatewaySessionStoreFiles(): string[] {
  const openclawStateDir = config.openclawStateDir
  if (!openclawStateDir) return []

  const agentsDir = path.join(openclawStateDir, 'agents')
  if (!fs.existsSync(agentsDir)) return []

  let agentDirs: string[]
  try {
    agentDirs = fs.readdirSync(agentsDir)
  } catch {
    return []
  }

  const files: string[] = []
  for (const agentName of agentDirs) {
    const sessionsFile = path.join(agentsDir, agentName, 'sessions', 'sessions.json')
    try {
      if (fs.statSync(sessionsFile).isFile()) files.push(sessionsFile)
    } catch {
      // Skip missing or unreadable session stores.
    }
  }
  return files
}

// TTL cache to avoid re-reading session files multiple times per scheduler tick.
// Stores sessions without the `active` flag so the cache is independent of activeWithinMs.
type RawSession = Omit<GatewaySession, 'active'>
let _sessionCache: { data: RawSession[]; ts: number } | null = null
const SESSION_CACHE_TTL_MS = 30_000

/** Invalidate the session cache (e.g. after pruning). */
export function invalidateSessionCache(): void {
  _sessionCache = null
}

/**
 * Read all sessions from OpenClaw agent session stores on disk.
 *
 * OpenClaw stores sessions per-agent at:
 *   {OPENCLAW_STATE_DIR}/agents/{agentName}/sessions/sessions.json
 *
 * Each file is a JSON object keyed by session key (e.g. "agent:<agent>:main")
 * with session metadata as values.
 */
export function getAllGatewaySessions(activeWithinMs = 60 * 60 * 1000, force = false): GatewaySession[] {
  const now = Date.now()

  let raw: RawSession[]
  if (!force && _sessionCache && (now - _sessionCache.ts) < SESSION_CACHE_TTL_MS) {
    raw = _sessionCache.data
  } else {
    const sessions: RawSession[] = []
    for (const sessionsFile of getGatewaySessionStoreFiles()) {
      const agentName = path.basename(path.dirname(path.dirname(sessionsFile)))
      try {
        const fileContent = fs.readFileSync(sessionsFile, 'utf-8')
        const data = JSON.parse(fileContent)

        for (const [key, entry] of Object.entries(data)) {
          const s = entry as Record<string, any>
          const updatedAt = s.updatedAt || 0
          sessions.push({
            key,
            agent: agentName,
            sessionId: s.sessionId || '',
            updatedAt,
            chatType: s.chatType || 'unknown',
            channel: s.deliveryContext?.channel || s.lastChannel || s.channel || '',
            model: typeof s.model === 'object' && s.model?.primary ? String(s.model.primary) : String(s.model || ''),
            totalTokens: s.totalTokens || 0,
            inputTokens: s.inputTokens || 0,
            outputTokens: s.outputTokens || 0,
            contextTokens: s.contextTokens || 0,
          })
        }
      } catch {
        // Skip agents without valid session files
      }
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    _sessionCache = { data: sessions, ts: Date.now() }
    raw = sessions
  }

  // Compute `active` at read time so it's always fresh regardless of cache age
  return raw.map(s => ({ ...s, active: (now - s.updatedAt) < activeWithinMs }))
}

export function countStaleGatewaySessions(retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0
  const cutoff = Date.now() - retentionDays * 86400000
  let stale = 0

  for (const sessionsFile of getGatewaySessionStoreFiles()) {
    try {
      const raw = fs.readFileSync(sessionsFile, 'utf-8')
      const data = JSON.parse(raw) as Record<string, any>
      for (const entry of Object.values(data)) {
        const updatedAt = Number((entry as any)?.updatedAt || 0)
        if (updatedAt > 0 && updatedAt < cutoff) stale += 1
      }
    } catch {
      // Ignore malformed session stores.
    }
  }

  return stale
}

export function pruneGatewaySessionsOlderThan(retentionDays: number): { deleted: number; filesTouched: number } {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { deleted: 0, filesTouched: 0 }
  const cutoff = Date.now() - retentionDays * 86400000
  let deleted = 0
  let filesTouched = 0

  for (const sessionsFile of getGatewaySessionStoreFiles()) {
    try {
      const raw = fs.readFileSync(sessionsFile, 'utf-8')
      const data = JSON.parse(raw) as Record<string, any>
      const nextEntries: Record<string, any> = {}
      let fileDeleted = 0

      for (const [key, entry] of Object.entries(data)) {
        const updatedAt = Number((entry as any)?.updatedAt || 0)
        if (updatedAt > 0 && updatedAt < cutoff) {
          fileDeleted += 1
          continue
        }
        nextEntries[key] = entry
      }

      if (fileDeleted > 0) {
        const tempPath = `${sessionsFile}.tmp`
        fs.writeFileSync(tempPath, `${JSON.stringify(nextEntries, null, 2)}\n`, 'utf-8')
        fs.renameSync(tempPath, sessionsFile)
        deleted += fileDeleted
        filesTouched += 1
      }
    } catch {
      // Ignore malformed/unwritable session stores.
    }
  }

  if (filesTouched > 0) invalidateSessionCache()
  return { deleted, filesTouched }
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
