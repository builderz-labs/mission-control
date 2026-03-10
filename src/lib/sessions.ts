import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { ensureDirExists } from './config'
import { getDatabase } from './db'
import { logAuditEvent } from './db'
import { randomBytes } from 'crypto'

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

function normalizeAgentName(value: string) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-')
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

  let agentDirs: string[]
  try {
    agentDirs = fs.readdirSync(agentsDir)
  } catch {
    return []
  }

  for (const agentName of agentDirs) {
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
          agent: agentName,
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

export function findGatewaySessionForAgent(agentName: string, activeWithinMs = 24 * 60 * 60 * 1000): GatewaySession | null {
  const normalized = normalizeAgentName(agentName)
  return (
    getAllGatewaySessions(activeWithinMs).find((session) => normalizeAgentName(session.agent) === normalized) ||
    null
  )
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

/** Ensure an on-disk gateway session exists for the given agent. Returns the created session metadata. */
export function startGatewaySession(agentName: string, opts?: { model?: string; chatType?: string; channel?: string; sessionId?: string }): GatewaySession | null {
  const openclawHome = config.openclawHome
  if (!openclawHome) return null

  const agentDir = path.join(openclawHome, 'agents', agentName)
  const sessionsDir = path.join(agentDir, 'sessions')
  ensureDirExists(sessionsDir)

  const sessionsFile = path.join(sessionsDir, 'sessions.json')
  let data: Record<string, any> = {}
  try {
    if (fs.existsSync(sessionsFile)) {
      data = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8') || '{}')
    }
  } catch {
    data = {}
  }

  const sid = opts?.sessionId || `${agentName}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
  const key = `agent:${agentName}:main:${sid}`
  const now = Date.now()

  data[key] = {
    sessionId: sid,
    updatedAt: now,
    chatType: opts?.chatType || 'main',
    deliveryContext: { channel: opts?.channel || 'default' },
    model: opts?.model || 'unknown',
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: 35000,
    active: true,
  }

  try {
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    return null
  }

  // Optionally log an activity in the local DB if available
  try {
    const db = getDatabase()
    db.prepare('INSERT INTO activities (type, entity_type, entity_id, actor, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('session_started', 'session', 0, 'system', `Session started for ${agentName} (${sid})`, Math.floor(now / 1000))
  } catch {
    // best-effort
  }

  return {
    key,
    agent: agentName,
    sessionId: sid,
    updatedAt: now,
    chatType: opts?.chatType || 'main',
    channel: opts?.channel || 'default',
    model: opts?.model || 'unknown',
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: 35000,
    active: true,
  }
}

export function ensureGatewaySessionForAgent(
  agentName: string,
  opts?: { model?: string; chatType?: string; channel?: string; sessionId?: string }
): GatewaySession | null {
  const existing = findGatewaySessionForAgent(agentName)
  if (existing) return existing
  return startGatewaySession(agentName, opts)
}

/** Auto-start sessions for agents that have no active session. Returns count started. */
export function autoStartSessions(maxPerRun = 10): number {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT name FROM agents').all() as Array<{ name: string }>
    const existing = getAllGatewaySessions(24 * 60 * 60 * 1000) // sessions active within 24h
    const activeAgents = new Set(existing.map(s => s.agent))
    let started = 0
    for (const r of rows) {
      if (started >= maxPerRun) break
      if (!activeAgents.has(r.name)) {
        const s = startGatewaySession(r.name)
        if (s) started++
      }
    }
    return started
  } catch {
    return 0
  }
}
