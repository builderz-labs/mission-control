import type { Database } from 'better-sqlite3'

export interface MentionTarget {
  handle: string
  recipient: string
  type: 'user' | 'agent' | 'team' | 'special'
  display: string
  role?: string
  teamId?: number
  memberAgents?: string[]
}

export interface MentionResolution {
  tokens: string[]
  unresolved: string[]
  recipients: string[]
  resolved: MentionTarget[]
}

// Supports @name, @team:name, @all, @human
const MENTION_PATTERN = /(^|[^A-Za-z0-9._-])@([A-Za-z0-9][A-Za-z0-9._:-]{0,63})/g

function normalizeAgentHandle(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

export function parseMentions(text: string): string[] {
  if (!text || typeof text !== 'string') return []

  const found: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const token = String(match[2] || '').trim().replace(/:+$/, '')
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(token)
  }

  return found
}

export function getMentionTargets(db: Database, workspaceId: number): MentionTarget[] {
  const targets: MentionTarget[] = []
  const seenHandles = new Set<string>()

  const users = db.prepare(`
    SELECT username, display_name
    FROM users
    WHERE workspace_id = ?
    ORDER BY username ASC
  `).all(workspaceId) as Array<{ username: string; display_name?: string | null }>

  for (const user of users) {
    const username = String(user.username || '').trim()
    if (!username) continue
    const handle = username.toLowerCase()
    if (seenHandles.has(handle)) continue
    seenHandles.add(handle)
    targets.push({
      handle,
      recipient: username,
      type: 'user',
      display: user.display_name?.trim() || username,
    })
  }

  const agents = db.prepare(`
    SELECT name, role, config
    FROM agents
    WHERE workspace_id = ?
    ORDER BY name ASC
  `).all(workspaceId) as Array<{ name: string; role?: string | null; config?: string | null }>

  for (const agent of agents) {
    const recipient = String(agent.name || '').trim()
    if (!recipient) continue

    let openclawId: string | null = null
    try {
      const parsed = agent.config ? JSON.parse(agent.config) : null
      if (parsed && typeof parsed.openclawId === 'string' && parsed.openclawId.trim()) {
        openclawId = parsed.openclawId.trim()
      }
    } catch {
      // ignore invalid config JSON for mention indexing
    }

    const candidateHandles = [openclawId, normalizeAgentHandle(recipient), recipient.toLowerCase()]
      .filter((value): value is string => Boolean(value))

    for (const rawHandle of candidateHandles) {
      const handle = rawHandle.toLowerCase()
      if (!handle || seenHandles.has(handle)) continue
      seenHandles.add(handle)
      targets.push({
        handle,
        recipient,
        type: 'agent',
        display: recipient,
        role: agent.role || undefined,
      })
    }
  }

  // Add teams
  const teams = db.prepare(`
    SELECT t.id, t.name
    FROM teams t
    WHERE t.workspace_id = ?
    ORDER BY t.name ASC
  `).all(workspaceId) as Array<{ id: number; name: string }>

  for (const team of teams) {
    const handle = `team:${normalizeAgentHandle(team.name)}`
    if (seenHandles.has(handle)) continue
    seenHandles.add(handle)

    const members = db.prepare(`
      SELECT a.name FROM team_members tm
      JOIN agents a ON a.id = tm.agent_id
      WHERE tm.team_id = ?
    `).all(team.id) as Array<{ name: string }>

    targets.push({
      handle,
      recipient: team.name,
      type: 'team',
      display: team.name,
      teamId: team.id,
      memberAgents: members.map(m => m.name),
    })
  }

  // Add special targets
  if (!seenHandles.has('all')) {
    targets.push({ handle: 'all', recipient: '__all__', type: 'special', display: 'All Agents' })
  }
  if (!seenHandles.has('human')) {
    targets.push({ handle: 'human', recipient: '__human__', type: 'special', display: 'Human Operator' })
  }

  return targets
}

export function resolveMentionRecipients(text: string, db: Database, workspaceId: number): MentionResolution {
  const tokens = parseMentions(text)
  if (tokens.length === 0) {
    return { tokens: [], unresolved: [], recipients: [], resolved: [] }
  }

  const targets = getMentionTargets(db, workspaceId)
  const byHandle = new Map<string, MentionTarget>()
  for (const target of targets) {
    byHandle.set(target.handle.toLowerCase(), target)
  }

  const resolved: MentionTarget[] = []
  const unresolved: string[] = []
  const recipientSeen = new Set<string>()

  for (const token of tokens) {
    const key = token.toLowerCase()
    const target = byHandle.get(key)
    if (!target) {
      unresolved.push(token)
      continue
    }

    if (target.type === 'special' && target.recipient === '__all__') {
      // Expand @all to all agents
      for (const t of targets) {
        if (t.type === 'agent' && !recipientSeen.has(t.recipient)) {
          recipientSeen.add(t.recipient)
          resolved.push(t)
        }
      }
    } else if (target.type === 'team' && target.memberAgents) {
      // Expand @team:name to member agents
      for (const memberName of target.memberAgents) {
        if (!recipientSeen.has(memberName)) {
          recipientSeen.add(memberName)
          const agentTarget = targets.find(t => t.type === 'agent' && t.recipient === memberName)
          if (agentTarget) resolved.push(agentTarget)
        }
      }
    } else if (target.type === 'special' && target.recipient === '__human__') {
      if (!recipientSeen.has('__human__')) {
        recipientSeen.add('__human__')
        resolved.push(target)
      }
    } else {
      if (!recipientSeen.has(target.recipient)) {
        recipientSeen.add(target.recipient)
        resolved.push(target)
      }
    }
  }

  return {
    tokens,
    unresolved,
    recipients: resolved.map((item) => item.recipient),
    resolved,
  }
}
