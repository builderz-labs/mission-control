import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, connectSchema } from '@/lib/validation'
import { eventBus } from '@/lib/event-bus'
import { randomUUID } from 'crypto'

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
  let agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agent_name, workspaceId) as any
  if (!agent) {
    const result = db.prepare(
      `INSERT INTO agents (name, role, status, created_at, updated_at, workspace_id)
       VALUES (?, ?, 'online', ?, ?, ?)`
    ).run(agent_name, agent_role || 'cli', now, now, workspaceId)
    agent = { id: result.lastInsertRowid, name: agent_name }
    db_helpers.logActivity('agent_created', 'agent', agent.id as number, 'system',
      `Auto-created agent "${agent_name}" via direct CLI connection`, undefined, workspaceId)
    eventBus.broadcast('agent.created', { id: agent.id, name: agent_name })
  } else {
    // Set agent online
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run('online', now, agent.id, workspaceId)
    eventBus.broadcast('agent.status_changed', { id: agent.id, name: agent.name, status: 'online' })
  }

  // Deactivate previous connections for this agent
  db.prepare(
    `UPDATE direct_connections SET status = 'disconnected', updated_at = ? WHERE agent_id = ? AND status = 'connected'`
  ).run(now, agent.id)

  // Create new connection
  const connectionId = randomUUID()
  db.prepare(
    `INSERT INTO direct_connections (agent_id, tool_name, tool_version, connection_id, status, last_heartbeat, metadata, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?)`
  ).run(agent.id, tool_name, tool_version || null, connectionId, now, metadata ? JSON.stringify(metadata) : null, now, now, workspaceId)

  db_helpers.logActivity('connection_created', 'agent', agent.id as number, agent_name,
    `CLI connection established via ${tool_name}${tool_version ? ` v${tool_version}` : ''}`, undefined, workspaceId)

  eventBus.broadcast('connection.created', {
    connection_id: connectionId,
    agent_id: agent.id,
    agent_name,
    tool_name,
  })

  return NextResponse.json({
    connection_id: connectionId,
    agent_id: agent.id,
    agent_name,
    status: 'connected',
    sse_url: `/api/events`,
    heartbeat_url: `/api/agents/${agent.id}/heartbeat`,
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

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { connection_id } = body
  if (!connection_id) {
    return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const workspaceId = auth.user.workspace_id ?? 1;

  const conn = db.prepare(`
    SELECT dc.*
    FROM direct_connections dc
    JOIN agents a ON a.id = dc.agent_id
    WHERE dc.connection_id = ? AND a.workspace_id = ?
  `).get(connection_id, workspaceId) as any
  if (!conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  db.prepare('UPDATE direct_connections SET status = ?, updated_at = ? WHERE connection_id = ?')
    .run('disconnected', now, connection_id)

  // Check if agent has other active connections; if not, set offline
  const otherActive = db.prepare(
    'SELECT COUNT(*) as count FROM direct_connections WHERE agent_id = ? AND status = ? AND connection_id != ?'
  ).get(conn.agent_id, 'connected', connection_id) as any
  if (!otherActive?.count) {
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run('offline', now, conn.agent_id, workspaceId)
  }

  const agent = db.prepare('SELECT name FROM agents WHERE id = ? AND workspace_id = ?').get(conn.agent_id, workspaceId) as any
  db_helpers.logActivity('connection_disconnected', 'agent', conn.agent_id, agent?.name || 'unknown',
    `CLI connection disconnected (${conn.tool_name})`, undefined, workspaceId)

  eventBus.broadcast('connection.disconnected', {
    connection_id,
    agent_id: conn.agent_id,
    agent_name: agent?.name,
  })

  return NextResponse.json({ status: 'disconnected', connection_id })
}
