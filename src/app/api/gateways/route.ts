import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getDetectedGatewayPort, getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

interface GatewayEntry {
  id: number
  name: string
  host: string
  port: number
  token: string
  is_primary: number
  status: string
  last_seen: number | null
  latency: number | null
  sessions_count: number
  agents_count: number
  created_at: number
  updated_at: number
}

function ensureTable(db: ReturnType<typeof getDatabase>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
}

/**
 * GET /api/gateways - List all registered gateways
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const db = getDatabase()
  ensureTable(db)

  const gateways = db.prepare('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC').all() as GatewayEntry[]

  // If no gateways exist, seed defaults from environment
  if (gateways.length === 0) {
    const name = String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary')
    const host = String(process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1')
    const mainPort = getDetectedGatewayPort() || parseInt(process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789')
    const mainToken = getDetectedGatewayToken()

    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, 1)
    `).run(name, host, mainPort, mainToken)

    const seeded = db.prepare('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC').all() as GatewayEntry[]
    return NextResponse.json({ gateways: redactTokens(seeded) })
  }

  return NextResponse.json({ gateways: redactTokens(gateways) })
}

/**
 * POST /api/gateways - Add a new gateway
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const db = getDatabase()
  ensureTable(db)
  const body = await request.json()

  const { name, host, port, token, is_primary, agents } = body

  if (!name || !host || !port) {
    return NextResponse.json({ error: 'name, host, and port are required' }, { status: 400 })
  }

  try {
    // If marking as primary, unset other primaries
    if (is_primary) {
      db.prepare('UPDATE gateways SET is_primary = 0').run()
    }

    const result = db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, ?)
    `).run(name, host, port, token || '', is_primary ? 1 : 0)

    // Auto-register agents reported by the gateway (k8s sidecar support)
    let agentsRegistered = 0
    if (Array.isArray(agents) && agents.length > 0) {
      const workspaceId = auth.user?.workspace_id ?? 1
      const now = Math.floor(Date.now() / 1000)
      const upsertAgent = db.prepare(`
        INSERT INTO agents (name, role, status, last_seen, source, workspace_id, updated_at)
        VALUES (?, ?, 'idle', ?, 'gateway', ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          status = 'idle',
          last_seen = excluded.last_seen,
          source = 'gateway',
          updated_at = excluded.updated_at
      `)
      for (const agent of agents.slice(0, 50)) {
        if (typeof agent?.name !== 'string' || !agent.name.trim()) continue
        const agentName = agent.name.trim().substring(0, 100)
        const agentRole = typeof agent?.role === 'string' ? agent.role.trim().substring(0, 100) : 'agent'
        upsertAgent.run(agentName, agentRole, now, workspaceId, now)
        agentsRegistered++
      }
    }

    try {
      db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run(
        'gateway_added', auth.user?.username || 'system', `Added gateway: ${name} (${host}:${port})${agentsRegistered ? `, registered ${agentsRegistered} agent(s)` : ''}`
      )
    } catch { /* audit might not exist */ }

    const gw = db.prepare('SELECT * FROM gateways WHERE id = ?').get(result.lastInsertRowid) as GatewayEntry
    return NextResponse.json({ gateway: redactToken(gw), agents_registered: agentsRegistered }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A gateway with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err.message || 'Failed to add gateway' }, { status: 500 })
  }
}

/**
 * PUT /api/gateways - Update a gateway
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const db = getDatabase()
  ensureTable(db)
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existing = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id) as GatewayEntry | undefined
  if (!existing) return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })

  // If setting as primary, unset others
  if (updates.is_primary) {
    db.prepare('UPDATE gateways SET is_primary = 0').run()
  }

  const allowed = ['name', 'host', 'port', 'token', 'is_primary', 'status', 'last_seen', 'latency', 'sessions_count', 'agents_count']
  const sets: string[] = []
  const values: any[] = []

  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`)
      values.push(updates[key])
    }
  }

  if (sets.length === 0 && !Array.isArray(updates.agents)) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  if (sets.length > 0) {
    sets.push('updated_at = (unixepoch())')
    values.push(id)
    db.prepare(`UPDATE gateways SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  // Auto-register agents reported by the gateway (k8s sidecar support)
  let agentsRegistered = 0
  if (Array.isArray(updates.agents) && updates.agents.length > 0) {
    const workspaceId = auth.user?.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)
    const upsertAgent = db.prepare(`
      INSERT INTO agents (name, role, status, last_seen, source, workspace_id, updated_at)
      VALUES (?, ?, 'idle', ?, 'gateway', ?, ?)
      ON CONFLICT(name, workspace_id) DO UPDATE SET
        status = 'idle',
        last_seen = excluded.last_seen,
        source = 'gateway',
        updated_at = excluded.updated_at
    `)
    for (const agent of updates.agents.slice(0, 50)) {
      if (typeof agent?.name !== 'string' || !agent.name.trim()) continue
      const agentName = agent.name.trim().substring(0, 100)
      const agentRole = typeof agent?.role === 'string' ? agent.role.trim().substring(0, 100) : 'agent'
      upsertAgent.run(agentName, agentRole, now, workspaceId, now)
      agentsRegistered++
    }
  }

  const updated = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id) as GatewayEntry
  return NextResponse.json({ gateway: redactToken(updated), agents_registered: agentsRegistered })
}

/**
 * DELETE /api/gateways - Remove a gateway
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const db = getDatabase()
  ensureTable(db)
  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const gw = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id) as GatewayEntry | undefined
  if (gw?.is_primary) {
    return NextResponse.json({ error: 'Cannot delete the primary gateway' }, { status: 400 })
  }

  const result = db.prepare('DELETE FROM gateways WHERE id = ?').run(id)

  try {
    db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run(
      'gateway_removed', auth.user?.username || 'system', `Removed gateway: ${gw?.name}`
    )
  } catch { /* audit might not exist */ }

  return NextResponse.json({ deleted: result.changes > 0 })
}

function redactToken(gw: GatewayEntry): GatewayEntry & { token_set: boolean } {
  return { ...gw, token: gw.token ? '--------' : '', token_set: !!gw.token }
}

function redactTokens(gws: GatewayEntry[]) {
  return gws.map(redactToken)
}
