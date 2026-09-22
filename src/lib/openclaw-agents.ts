import { join } from 'node:path'

export type OpenClawAgentRecord = {
  id: string
  name?: string
  identity?: { name?: string; theme?: string; emoji?: string }
  workspace?: string
  [key: string]: unknown
}

type AgentMatch = { id?: string | null; name?: string | null }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function defaultWorkspace(stateDir: string | undefined, id: string): string | undefined {
  if (!stateDir || !id) return undefined
  return join(stateDir, `workspace-${id}`)
}

export function listOpenClawAgents(parsed: unknown, stateDir?: string): OpenClawAgentRecord[] {
  const agents = asRecord((parsed as { agents?: unknown } | null)?.agents)
  if (!agents) return []

  const entries = agents.entries
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return Object.entries(entries as Record<string, unknown>)
      .filter(([, entry]) => asRecord(entry))
      .map(([id, entry]) => {
        const rec = asRecord(entry) as OpenClawAgentRecord
        return {
          ...rec,
          id,
          workspace: rec.workspace || defaultWorkspace(stateDir, id),
        }
      })
  }

  if (!Array.isArray(agents.list)) return []
  return (agents.list as unknown[])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const id = String(entry.id || entry.name || '').trim()
      return {
        ...(entry as OpenClawAgentRecord),
        id,
        workspace: (entry.workspace as string | undefined) || defaultWorkspace(stateDir, id),
      }
    })
    .filter((entry) => Boolean(entry.id))
}

function namesOf(agent: OpenClawAgentRecord): string[] {
  return [agent.id, agent.name, agent.identity?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

export function findOpenClawAgent(parsed: unknown, id: string): OpenClawAgentRecord | null {
  const needle = String(id || '').trim()
  if (!needle) return null
  return listOpenClawAgents(parsed).find((agent) => agent.id === needle) || null
}

export function upsertOpenClawAgent(parsed: Record<string, unknown>, agentConfig: OpenClawAgentRecord): void {
  const id = String(agentConfig.id || '').trim()
  if (!id) throw new Error('OpenClaw agent id is required')
  if (!asRecord(parsed.agents)) parsed.agents = {}
  const agents = parsed.agents as Record<string, unknown>
  const { id: _id, ...rest } = agentConfig

  const entries = agents.entries
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    const table = entries as Record<string, unknown>
    table[id] = rest
    return
  }

  if (Array.isArray(agents.list)) {
    const list = agents.list as OpenClawAgentRecord[]
    const idx = list.findIndex((agent) => String(agent?.id || '').trim() === id)
    if (idx >= 0) list[idx] = { ...agentConfig, id }
    else list.push({ ...agentConfig, id })
    return
  }

  agents.ownership = agents.ownership || 'explicit'
  agents.entries = { [id]: rest }
}

export function removeOpenClawAgent(parsed: Record<string, unknown>, match: AgentMatch): boolean {
  const id = String(match.id || '').trim()
  const name = String(match.name || '').trim()
  if (!id && !name) return false
  const agents = asRecord(parsed.agents)
  if (!agents) return false

  let removed = false
  const entries = agents.entries
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    const table = entries as Record<string, unknown>
    for (const [key, value] of Object.entries(table)) {
      const rec = { ...(asRecord(value) || {}), id: key } as OpenClawAgentRecord
      const labels = namesOf(rec)
      if ((id && labels.includes(id)) || (name && labels.includes(name))) {
        delete table[key]
        removed = true
      }
    }
  }

  if (Array.isArray(agents.list)) {
    const list = agents.list as OpenClawAgentRecord[]
    const next = list.filter((agent) => {
      const labels = namesOf(agent)
      if (id && labels.includes(id)) return false
      if (name && labels.includes(name)) return false
      return true
    })
    if (next.length !== list.length) {
      agents.list = next
      removed = true
    }
  }

  return removed
}
