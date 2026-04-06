import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, connectSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import { randomUUID } from 'crypto'

interface AgentRow {
  id: number
  name: string
  role: string
  status: string
  session_key: string | null
  last_seen: number | null
  last_activity: number | null
  created_at: number
  updated_at: number
  config: string | null
  workspace_id: number
  source: string | null
  content_hash: string | null
  workspace_path: string | null
}

interface ConnectionRow {
  id: number
  agent_id: number
  tool_name: string
  connection_id: string
  status: string
}

interface CountRow {
  count: number
}

/**
 * POST /api/connect — Register a direct CLI connection
 *
 * Auto-creates agent if name doesn't exist, deactivates previous connections
 * for the same agent, and returns connection details + helper URLs.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const validation = await validateBody(request, connectSchema)
  if ('error' in validation) return validation.error

  const { tool_name, tool_version, agent_name, agent_role, metadata } = validation.data
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const workspaceId = auth.user.workspace_id ?? 1;

  // Find or create agent
  const existingAgent = db.prepare('SELECT id, name, role, session_key, status, last_seen, last_activity, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path FROM agents WHERE name = ? AND workspace_id = ?').get(agent_name, workspaceId) as AgentRow | undefined
  let agentId: number
  if (!existingAgent) {
    const result = db.prepare(
      `INSERT INTO agents (name, role, status, created_at, updated_at, workspace_id)
       VALUES (?, ?, 'online', ?, ?, ?)`
    ).run(agent_name, agent_role || 'cli', now, now, workspaceId)
    agentId = Number(result.lastInsertRowid)
    db_helpers.logActivity('agent_created', 'agent', agentId, 'system',
      `Auto-created agent "${agent_name}" via direct CLI connection`, undefined, workspaceId)
    eventBus.broadcast('agent.created', { id: agentId, name: agent_name })
  } else {
    agentId = existingAgent.id
    // Set agent online
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run('online', now, agentId, workspaceId)
    eventBus.broadcast('agent.status_changed', { id: agentId, name: existingAgent.name, status: 'online' })
  }

  // Deactivate previous connections for this agent
  db.prepare(
    `UPDATE direct_connections SET status = 'disconnected', updated_at = ? WHERE agent_id = ? AND status = 'connected'`
  ).run(now, agentId)

  // Create new connection
  const connectionId = randomUUID()
  db.prepare(
    `INSERT INTO direct_connections (agent_id, tool_name, tool_version, connection_id, status, last_heartbeat, metadata, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?)`
  ).run(agentId, tool_name, tool_version || null, connectionId, now, metadata ? JSON.stringify(metadata) : null, now, now, workspaceId)

  db_helpers.logActivity('connection_created', 'agent', agentId, agent_name,
    `CLI connection established via ${tool_name}${tool_version ? ` v${tool_version}` : ''}`, undefined, workspaceId)

  eventBus.broadcast('connection.created', {
    connection_id: connectionId,
    agent_id: agentId,
    agent_name,
    tool_name,
  })

  return NextResponse.json({
    connection_id: connectionId,
    agent_id: agentId,
    agent_name,
    status: 'connected',
    sse_url: `/api/events`,
    heartbeat_url: `/api/agents/${agentId}/heartbeat`,
    token_report_url: `/api/tokens`,
  })
}

/**
 * GET /api/connect — List all direct connections
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1;
  const connections = db.prepare(`
    SELECT dc.*, a.name as agent_name, a.status as agent_status, a.role as agent_role
    FROM direct_connections dc
    JOIN agents a ON dc.agent_id = a.id
    WHERE a.workspace_id = ?
    ORDER BY dc.created_at DESC
  `).all(workspaceId)

  return NextResponse.json({ connections })
}

/**
 * DELETE /api/connect — Disconnect by connection_id
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const connection_id = typeof body['connection_id'] === 'string' ? body['connection_id'] : null
  if (!connection_id) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const workspaceId = auth.user.workspace_id ?? 1;

  const conn = db.prepare(`
    SELECT dc.id, dc.agent_id, dc.tool_name, dc.connection_id, dc.status
    FROM direct_connections dc
    JOIN agents a ON a.id = dc.agent_id
    WHERE dc.connection_id = ? AND a.workspace_id = ?
  `).get(connection_id, workspaceId) as ConnectionRow | undefined
  if (!conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  db.prepare('UPDATE direct_connections SET status = ?, updated_at = ? WHERE connection_id = ?')
    .run('disconnected', now, connection_id)

  // Check if agent has other active connections; if not, set offline
  const otherActive = db.prepare(
    'SELECT COUNT(*) as count FROM direct_connections WHERE agent_id = ? AND status = ? AND connection_id != ?'
  ).get(conn.agent_id, 'connected', connection_id) as CountRow | undefined
  if (!otherActive?.count) {
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run('offline', now, conn.agent_id, workspaceId)
  }

  const agentRow = db.prepare('SELECT name FROM agents WHERE id = ? AND workspace_id = ?').get(conn.agent_id, workspaceId) as { name: string } | undefined
  db_helpers.logActivity('connection_disconnected', 'agent', conn.agent_id, agentRow?.name || 'unknown',
    `CLI connection disconnected (${conn.tool_name})`, undefined, workspaceId)

  eventBus.broadcast('connection.disconnected', {
    connection_id,
    agent_id: conn.agent_id,
    agent_name: agentRow?.name,
  })

  return NextResponse.json({ status: 'disconnected', connection_id })
}
