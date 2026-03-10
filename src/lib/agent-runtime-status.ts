import { existsSync } from 'fs'
import { join } from 'path'
import { getDatabase, db_helpers } from '@/lib/db'
import { config } from '@/lib/config'
import { getOrchestratorControlState } from '@/lib/orchestrator-control'
import { ensureGatewaySessionForAgent } from '@/lib/sessions'

export interface LocalRuntimeStatus {
  available: boolean
  active: boolean
  source: 'gateway' | 'openclaw' | 'clawdbot' | 'orchestrator' | 'scheduler' | 'none'
  agentName: string | null
  model: string | null
  reason: string
  projectName?: string | null
}

const LOCAL_RUNTIME_STALE_AFTER_SECONDS = 10 * 60
const DEFAULT_COORDINATOR_AGENT = 'TechLead'

type AgentRow = {
  id: number
  name: string
  role: string
  status: string
  config: string | null
}

function commandExists(bin: string): boolean {
  try {
    if (!bin) return false
    if (bin.includes('\\') || bin.includes('/') || /^[a-zA-Z]:/.test(bin)) {
      return existsSync(bin)
    }
    const { spawnSync } = require('child_process')
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(checker, [bin], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

function parseAgentConfig(raw: string | null) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function getConfiguredCoordinatorName() {
  const configured = String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || '').trim()
  if (!configured || configured.toLowerCase() === 'coordinator') return DEFAULT_COORDINATOR_AGENT
  return configured
}

function pickRuntimeAgent(): AgentRow | null {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, name, role, status, config FROM agents ORDER BY updated_at DESC, id ASC').all() as AgentRow[]
  if (!rows.length) return null
  const preferredCoordinator = getConfiguredCoordinatorName().toLowerCase()

  const scored = rows
    .map((row) => {
      const cfg = parseAgentConfig(row.config)
      let score = 0
      if (row.name.toLowerCase() === preferredCoordinator) score += 200
      if (row.name === 'TechLead') score += 100
      if (String(row.name).toLowerCase().includes('groq')) score += 80
      if (String(row.role).toLowerCase().includes('orchestrator')) score += 70
      if (String(row.role).toLowerCase().includes('groq')) score += 60
      if ((cfg as any).team === 'orchestrator') score += 50
      if (typeof (cfg as any).model === 'string' && String((cfg as any).model).toLowerCase().includes('groq')) score += 40
      if (row.status === 'busy') score += 10
      if (row.status === 'idle') score += 5
      return { row, score, cfg }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.score > 0 ? scored[0].row : null
}

function getAgentModel(agent: AgentRow | null) {
  if (!agent?.config) return null
  const cfg = parseAgentConfig(agent.config) as Record<string, any>
  if (typeof cfg.model === 'string') return cfg.model
  if (cfg.model && typeof cfg.model.primary === 'string') return cfg.model.primary
  if (cfg.model?.primary && typeof cfg.model.primary.primary === 'string') return cfg.model.primary.primary
  return null
}

function getLatestProject() {
  try {
    const db = getDatabase()
    return db.prepare('SELECT id, name, folder FROM orchestrator_projects ORDER BY updated_at DESC, id DESC LIMIT 1').get() as
      | { id: number; name: string; folder: string }
      | undefined
  } catch {
    return undefined
  }
}

function hasProjectRuntime() {
  const project = getLatestProject()
  if (!project?.folder) return { available: false, project: null as null | { name: string } }
  const entry = join(project.folder, 'index.js')
  return {
    available: existsSync(entry),
    project: { name: project.name },
  }
}

export function getLocalRuntimeStatus(): LocalRuntimeStatus {
  const db = getDatabase()
  const activeConnection = db.prepare(`
    SELECT dc.status, dc.last_heartbeat, dc.updated_at, a.name as agent_name, a.config
    FROM direct_connections dc
    JOIN agents a ON a.id = dc.agent_id
    WHERE dc.status = 'connected'
      AND dc.metadata LIKE '%"mode":"local-runtime"%'
    ORDER BY dc.updated_at DESC, dc.id DESC
    LIMIT 1
  `).get() as { status: string; last_heartbeat?: number | null; updated_at?: number | null; agent_name: string; config: string | null } | undefined

  const runtimeAgent = pickRuntimeAgent()
  const lastTouch = activeConnection
    ? Math.max(Number(activeConnection.last_heartbeat || 0), Number(activeConnection.updated_at || 0))
    : 0
  const runtimeConnectionIsFresh = lastTouch > 0 && (Math.floor(Date.now() / 1000) - lastTouch) <= LOCAL_RUNTIME_STALE_AFTER_SECONDS
  const runtimeModel = activeConnection?.config
    ? getAgentModel({ id: 0, name: activeConnection.agent_name, role: '', status: 'idle', config: activeConnection.config })
    : getAgentModel(runtimeAgent)

  if (activeConnection && runtimeConnectionIsFresh) {
    return {
      available: true,
      active: true,
      source: 'orchestrator',
      agentName: activeConnection.agent_name,
      model: runtimeModel,
      reason: `Local orchestrator runtime active via ${activeConnection.agent_name}`,
    }
  }

  if (activeConnection && !runtimeConnectionIsFresh) {
    return {
      available: true,
      active: false,
      source: 'orchestrator',
      agentName: activeConnection.agent_name,
      model: runtimeModel,
      reason: `Local orchestrator runtime heartbeat is stale for ${activeConnection.agent_name}`,
    }
  }

  if (commandExists(config.openclawBin || '')) {
    return {
      available: true,
      active: false,
      source: 'openclaw',
      agentName: runtimeAgent?.name || null,
      model: runtimeModel,
      reason: `OpenClaw runtime available: ${config.openclawBin}`,
    }
  }

  if (commandExists(config.clawdbotBin || '')) {
    return {
      available: true,
      active: false,
      source: 'clawdbot',
      agentName: runtimeAgent?.name || null,
      model: runtimeModel,
      reason: `Clawdbot runtime available: ${config.clawdbotBin}`,
    }
  }

  const projectRuntime = hasProjectRuntime()
  if (projectRuntime.available) {
    return {
      available: true,
      active: false,
      source: 'orchestrator',
      agentName: runtimeAgent?.name || 'TechLead',
      model: runtimeModel,
      reason: `Local orchestrator project available${projectRuntime.project?.name ? `: ${projectRuntime.project.name}` : ''}`,
      projectName: projectRuntime.project?.name || null,
    }
  }

  const orchestratorState = getOrchestratorControlState()
  if (runtimeAgent && orchestratorState.state !== 'stopped') {
    return {
      available: true,
      active: false,
      source: 'scheduler',
      agentName: runtimeAgent.name,
      model: runtimeModel,
      reason: `Scheduler/orchestrator ready via ${runtimeAgent.name}`,
    }
  }

  return {
    available: false,
    active: false,
    source: 'none',
    agentName: runtimeAgent?.name || null,
    model: runtimeModel,
    reason: 'No local orchestrator runtime or gateway is available',
  }
}

export function activateLocalRuntime(actor: string, preferredAgentName?: string | null) {
  const runtime = getLocalRuntimeStatus()
  if (!runtime.available) {
    return {
      ok: false,
      error: runtime.reason,
      runtime,
    }
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const desiredName = preferredAgentName || runtime.agentName || 'TechLead'
  const agent = db.prepare('SELECT id, name, config, session_key FROM agents WHERE name = ?').get(desiredName) as
    | { id: number; name: string; config: string | null; session_key?: string | null }
    | undefined

  if (!agent) {
    return {
      ok: false,
      error: `Runtime agent "${desiredName}" not found`,
      runtime,
    }
  }

  db.prepare(
    `UPDATE direct_connections
     SET status = 'disconnected', updated_at = ?
     WHERE agent_id = ? AND status = 'connected'`
  ).run(now, agent.id)

  const connectionId = `local-runtime-${agent.id}`
  const metadata = JSON.stringify({
    mode: 'local-runtime',
    source: runtime.source,
    provider: runtime.model || runtime.source,
    activated_by: actor,
  })

  db.prepare(`
    INSERT INTO direct_connections (agent_id, tool_name, tool_version, connection_id, status, last_heartbeat, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET
      tool_name = excluded.tool_name,
      tool_version = excluded.tool_version,
      status = 'connected',
      last_heartbeat = excluded.last_heartbeat,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).run(agent.id, 'local-runtime', runtime.model || runtime.source, connectionId, now, metadata, now, now)

  db.prepare(`UPDATE agents SET status = 'idle', last_seen = ?, updated_at = ? WHERE id = ?`).run(now, now, agent.id)
  const ensuredSession = ensureGatewaySessionForAgent(agent.name, {
    model: runtime.model || undefined,
    chatType: 'main',
    channel: 'orchestrator',
  })
  if (ensuredSession?.key && ensuredSession.key !== agent.session_key) {
    db.prepare('UPDATE agents SET session_key = ?, updated_at = ? WHERE id = ?').run(
      ensuredSession.key,
      now,
      agent.id
    )
  }
  db_helpers.logActivity(
    'connection_created',
    'agent',
    agent.id,
    actor,
    `Activated local runtime for ${agent.name} via ${runtime.source}`
  )

  return {
    ok: true,
    connection_id: connectionId,
    agent_id: agent.id,
    agent_name: agent.name,
    status: 'connected',
    mode: 'local-runtime',
    runtime: {
      ...runtime,
      active: true,
      agentName: agent.name,
    },
    gateway_session_key: ensuredSession?.key || agent.session_key || null,
  }
}
