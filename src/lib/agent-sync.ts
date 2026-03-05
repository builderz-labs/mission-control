/**
 * Agent Config Sync
 *
 * Reads agents from openclaw.json and upserts them into the MC database.
 * Used by both the /api/agents/sync endpoint and the startup scheduler.
 */

import { config } from './config'
import { getDatabase, logAuditEvent } from './db'
import { eventBus } from './event-bus'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getNovaFrontDoorId, getNovaFrontDoorName, unaliasAgentForRuntime } from './identity-alias'

interface OpenClawAgent {
  id: string
  name?: string
  default?: boolean
  workspace?: string
  agentDir?: string
  model?: {
    primary?: string
    fallbacks?: string[]
  }
  identity?: {
    name?: string
    theme?: string
    emoji?: string
  }
  subagents?: any
  sandbox?: {
    mode?: string
    workspaceAccess?: string
    scope?: string
    docker?: any
  }
  tools?: {
    allow?: string[]
    deny?: string[]
  }
  memorySearch?: any
}

export interface SyncResult {
  synced: number
  created: number
  updated: number
  removed: number
  agents: Array<{
    id: string
    name: string
    action: 'created' | 'updated' | 'unchanged'
  }>
  error?: string
}

export interface SyncDiff {
  inConfig: number
  inMC: number
  newAgents: string[]
  updatedAgents: string[]
  onlyInMC: string[]
}

function getConfigPath(): string | null {
  if (!config.openclawHome) return null
  return join(config.openclawHome, 'openclaw.json')
}

/** Read and parse openclaw.json agents list */
async function readOpenClawAgents(): Promise<OpenClawAgent[]> {
  const configPath = getConfigPath()
  if (!configPath) throw new Error('OPENCLAW_HOME not configured')

  const { readFile } = require('fs/promises')
  const raw = await readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw)
  return parsed?.agents?.list || []
}

/** Read SOUL.md from workspace/agentDir so MC editor isn't empty */
async function readSoulContent(agent: OpenClawAgent): Promise<string> {
  const { readFile } = require('fs/promises')
  const candidates = [
    agent.workspace ? join(agent.workspace, 'SOUL.md') : null,
    agent.agentDir ? join(agent.agentDir, 'SOUL.md') : null,
  ].filter(Boolean)

  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf-8')
      if (raw && raw.trim()) return raw
    } catch {
      // ignore
    }
  }
  return ''
}

/** Extract MC-friendly fields from an OpenClaw agent config */
async function mapAgentToMC(agent: OpenClawAgent): Promise<{
  id: string
  name: string
  role: string
  config: any
  session_key: string
  soul_content: string
}> {
  const name = agent.identity?.name || agent.name || agent.id
  const role = agent.identity?.theme || 'agent'

  const configData = {
    openclawId: agent.id,
    model: agent.model,
    identity: agent.identity,
    sandbox: agent.sandbox,
    tools: agent.tools,
    subagents: agent.subagents,
    memorySearch: agent.memorySearch,
    workspace: agent.workspace,
    agentDir: agent.agentDir,
    isDefault: agent.default || false,
  }

  const soul_content = await readSoulContent(agent)
  const session_key = `agent:${agent.id}:main`

  return { id: agent.id, name, role, config: configData, session_key, soul_content }
}

function ensureNovaAgent(db: ReturnType<typeof getDatabase>, now: number) {
  const novaId = getNovaFrontDoorId() // usually "nova"
  const runtimeId = unaliasAgentForRuntime(novaId) // usually "main"
  const novaName = getNovaFrontDoorName()

  const workspacePath = join(config.openclawHome || '/root/.openclaw', 'workspace')
  const soulPath = join(workspacePath, 'SOUL.md')
  const memoryPath = join(workspacePath, 'MEMORY.md')
  const soul_content = existsSync(soulPath) ? readFileSync(soulPath, 'utf-8') : ''

  const configData = {
    openclawId: runtimeId,
    logicalId: novaId,
    identity: { name: novaName, theme: 'front-door interface', emoji: '🧠' },
    isFrontDoor: true,
    isDefault: true,
    workspace: workspacePath,
    memoryPath,
  }

  const session_key = `agent:${runtimeId}:main`

  const existing = db.prepare('SELECT id, config, role, session_key, soul_content FROM agents WHERE name = ?').get(novaName) as any
  const configJson = JSON.stringify(configData)

  if (!existing) {
    db.prepare(`
      INSERT INTO agents (name, role, session_key, soul_content, status, created_at, updated_at, config)
      VALUES (?, ?, ?, ?, 'offline', ?, ?, ?)
    `).run(novaName, 'front-door interface', session_key, soul_content, now, now, configJson)
    return
  }

  const changed =
    (existing.config || '{}') !== configJson ||
    existing.role !== 'front-door interface' ||
    (existing.session_key || '') !== session_key ||
    (existing.soul_content || '') !== soul_content

  if (changed) {
    db.prepare(`
      UPDATE agents
      SET role = ?, session_key = ?, soul_content = ?, config = ?, updated_at = ?
      WHERE name = ?
    `).run('front-door interface', session_key, soul_content, configJson, now, novaName)
  }
}

/** Sync agents from openclaw.json into the MC database */
export async function syncAgentsFromConfig(actor: string = 'system'): Promise<SyncResult> {
  let agents: OpenClawAgent[]
  try {
    agents = await readOpenClawAgents()
  } catch (err: any) {
    return { synced: 0, created: 0, updated: 0, removed: 0, agents: [], error: err.message }
  }

  if (agents.length === 0) {
    return { synced: 0, created: 0, updated: 0, removed: 0, agents: [] }
  }

  const mappedAgents = await Promise.all(agents.map(mapAgentToMC))

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  let created = 0
  let updated = 0
  let removed = 0
  const results: SyncResult['agents'] = []

  const findByName = db.prepare('SELECT id, name, role, config, soul_content, session_key FROM agents WHERE name = ?')
  const insertAgent = db.prepare(`
    INSERT INTO agents (name, role, session_key, soul_content, status, created_at, updated_at, config)
    VALUES (?, ?, ?, ?, 'offline', ?, ?, ?)
  `)
  const updateAgent = db.prepare(`
    UPDATE agents
    SET role = ?, session_key = ?, soul_content = ?, config = ?, updated_at = ?
    WHERE name = ?
  `)

  db.transaction(() => {
    for (const mapped of mappedAgents) {
      const configJson = JSON.stringify(mapped.config)
      const existing = findByName.get(mapped.name) as any

      if (existing) {
        const changed =
          (existing.config || '{}') !== configJson ||
          existing.role !== mapped.role ||
          (existing.session_key || '') !== mapped.session_key ||
          (existing.soul_content || '') !== mapped.soul_content

        if (changed) {
          updateAgent.run(
            mapped.role,
            mapped.session_key,
            mapped.soul_content,
            configJson,
            now,
            mapped.name,
          )
          results.push({ id: mapped.id, name: mapped.name, action: 'updated' })
          updated++
        } else {
          results.push({ id: mapped.id, name: mapped.name, action: 'unchanged' })
        }
      } else {
        insertAgent.run(
          mapped.name,
          mapped.role,
          mapped.session_key,
          mapped.soul_content,
          now,
          now,
          configJson,
        )
        results.push({ id: mapped.id, name: mapped.name, action: 'created' })
        created++
      }
    }

    // Always ensure Nova (front-door identity) is present
    ensureNovaAgent(db, now)

    // Prune stale DB-only agents not present in config (enterprise source-of-truth mode)
    const pruneStale = (process.env.MC_SYNC_PRUNE_STALE ?? 'true') !== 'false'
    if (pruneStale) {
      const allowed = new Set<string>([
        ...mappedAgents.map((a) => a.name),
        getNovaFrontDoorName(),
      ])

      const stale = db.prepare('SELECT id, name FROM agents').all() as Array<{ id: number; name: string }>
      for (const row of stale) {
        if (allowed.has(row.name)) continue
        db.prepare('DELETE FROM agents WHERE id = ?').run(row.id)
        removed += 1
      }
    }
  })()

  const synced = mappedAgents.length + 1

  if (created > 0 || updated > 0 || removed > 0) {
    logAuditEvent({
      action: 'agent_config_sync',
      actor,
      detail: {
        synced,
        created,
        updated,
        removed,
        agents: results.filter((a) => a.action !== 'unchanged').map((a) => a.name),
      },
    })

    eventBus.broadcast('agent.created', { type: 'sync', synced, created, updated, removed })
  }

  console.log(`Agent sync: ${synced} total, ${created} new, ${updated} updated, ${removed} removed`)
  return { synced, created, updated, removed, agents: results }
}

/** Preview the diff between openclaw.json and MC database without writing */
export async function previewSyncDiff(): Promise<SyncDiff> {
  let agents: OpenClawAgent[]
  try {
    agents = await readOpenClawAgents()
  } catch {
    return { inConfig: 0, inMC: 0, newAgents: [], updatedAgents: [], onlyInMC: [] }
  }

  const mappedAgents = await Promise.all(agents.map(mapAgentToMC))

  const db = getDatabase()
  const allMCAgents = db.prepare('SELECT name, role, config, soul_content, session_key FROM agents').all() as Array<{
    name: string
    role: string
    config: string
    soul_content: string
    session_key: string
  }>

  const newAgents: string[] = []
  const updatedAgents: string[] = []
  const configNames = new Set<string>()

  const novaName = getNovaFrontDoorName()
  const novaSessionKey = `agent:${unaliasAgentForRuntime(getNovaFrontDoorId())}:main`

  for (const mapped of mappedAgents) {
    configNames.add(mapped.name)

    const existing = allMCAgents.find((a) => a.name === mapped.name)
    if (!existing) {
      newAgents.push(mapped.name)
    } else {
      const configJson = JSON.stringify(mapped.config)
      const changed =
        existing.config !== configJson ||
        existing.role !== mapped.role ||
        (existing.session_key || '') !== mapped.session_key ||
        (existing.soul_content || '') !== mapped.soul_content
      if (changed) updatedAgents.push(mapped.name)
    }
  }

  // Nova front-door identity is managed by MC even when not listed in openclaw.json
  configNames.add(novaName)
  const existingNova = allMCAgents.find((a) => a.name === novaName)
  if (!existingNova) {
    newAgents.push(novaName)
  } else {
    const cfg = existingNova.config ? JSON.parse(existingNova.config) : {}
    const expectedOpenclawId = unaliasAgentForRuntime(getNovaFrontDoorId())
    const changed =
      existingNova.role !== 'front-door interface' ||
      (existingNova.session_key || '') !== novaSessionKey ||
      cfg?.openclawId !== expectedOpenclawId
    if (changed) updatedAgents.push(novaName)
  }

  const onlyInMC = allMCAgents.map((a) => a.name).filter((name) => !configNames.has(name))

  return {
    inConfig: mappedAgents.length + 1,
    inMC: allMCAgents.length,
    newAgents,
    updatedAgents,
    onlyInMC,
  }
}

/** Write an agent config back to openclaw.json agents.list */
export async function writeAgentToConfig(agentConfig: any): Promise<void> {
  const configPath = getConfigPath()
  if (!configPath) throw new Error('OPENCLAW_HOME not configured')

  const { readFile, writeFile } = require('fs/promises')
  const raw = await readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw)

  const list = parsed?.agents?.list || []
  const idx = list.findIndex((a: any) => a.id === agentConfig.id)

  if (idx >= 0) {
    list[idx] = agentConfig
  } else {
    list.push(agentConfig)
  }

  parsed.agents = parsed.agents || {}
  parsed.agents.list = list

  await writeFile(configPath, JSON.stringify(parsed, null, 2))
}
