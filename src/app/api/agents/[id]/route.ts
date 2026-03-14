import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Agent, db_helpers, logAuditEvent } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { writeAgentToConfig, enrichAgentConfigFromWorkspace } from '@/lib/agent-sync'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

/**
 * GET /api/agents/[id] - Get a single agent by ID or name
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;

    let agent: Agent | undefined
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as Agent | undefined
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as Agent | undefined
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const parsed = {
      ...agent,
      config: enrichAgentConfigFromWorkspace(agent.config ? JSON.parse(agent.config) : {}),
    }

    return NextResponse.json({ agent: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id] error')
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id] - Update agent config with unified MC + gateway save
 *
 * Body: {
 *   role?: string
 *   gateway_config?: object   - OpenClaw agent config fields to update
 *   write_to_gateway?: boolean - Defaults to true when gateway_config exists
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json()
    const { role, gateway_config, write_to_gateway } = body

    let agent: Agent | undefined
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as Agent | undefined
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as Agent | undefined
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const existingConfig = agent.config ? JSON.parse(agent.config) : {}

    // Merge gateway_config into existing config
    let newConfig = existingConfig
    if (gateway_config && typeof gateway_config === 'object') {
      newConfig = { ...existingConfig, ...gateway_config }
    }

    const shouldWriteToGateway = Boolean(
      gateway_config &&
      (write_to_gateway === undefined || write_to_gateway === null || write_to_gateway === true)
    )
    const openclawId = existingConfig.openclawId || agent.name.toLowerCase().replace(/\s+/g, '-')
    const getWriteBackPayload = (source: Record<string, any>) => {
      const writeBack: any = { id: openclawId }
      if (source.model) writeBack.model = source.model
      if (source.identity) writeBack.identity = source.identity
      if (source.sandbox) writeBack.sandbox = source.sandbox
      if (source.tools) writeBack.tools = source.tools
      if (source.subagents) writeBack.subagents = source.subagents
      if (source.memorySearch) writeBack.memorySearch = source.memorySearch
      return writeBack
    }

    // Unified save: gateway first, then DB. If DB fails after gateway write, attempt rollback.
    if (shouldWriteToGateway) {
      try {
        await writeAgentToConfig(getWriteBackPayload(gateway_config))
      } catch (err: any) {
        return NextResponse.json(
          { error: `Save failed: unable to update gateway config: ${err.message}` },
          { status: 502 }
        )
      }
    }

    try {
      // Build update
      const fields: string[] = ['updated_at = ?']
      const values: any[] = [now]

      if (role !== undefined) {
        fields.push('role = ?')
        values.push(role)
      }

      if (gateway_config) {
        fields.push('config = ?')
        values.push(JSON.stringify(newConfig))
      }

      values.push(agent.id, workspaceId)
      db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values)
    } catch (err: any) {
      if (shouldWriteToGateway) {
        try {
          // Best-effort rollback to preserve consistency if DB update fails after gateway write.
          await writeAgentToConfig(getWriteBackPayload(existingConfig))
        } catch (rollbackErr: any) {
          logger.error({ err: rollbackErr, agent: agent.name }, 'Failed to rollback gateway config after DB failure')
          return NextResponse.json(
            { error: `Save failed after gateway update and rollback failed: ${err.message}` },
            { status: 500 }
          )
        }
      }
      return NextResponse.json({ error: `Save failed: ${err.message}` }, { status: 500 })
    }

    if (shouldWriteToGateway) {
      const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      logAuditEvent({
        action: 'agent_config_writeback',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'agent',
        target_id: agent.id,
        detail: { agent_name: agent.name, openclaw_id: openclawId, fields: Object.keys(gateway_config || {}) },
        ip_address: ipAddress,
      })
    }

    // Log activity
    db_helpers.logActivity(
      'agent_config_updated',
      'agent',
      agent.id,
      auth.user.username,
      `Config updated for agent ${agent.name}${shouldWriteToGateway ? ' (+ gateway)' : ''}`,
      { fields: Object.keys(gateway_config || {}), write_to_gateway: shouldWriteToGateway },
      workspaceId
    )

    // Broadcast update
    eventBus.broadcast('agent.updated', {
      id: agent.id,
      name: agent.name,
      config: newConfig,
      updated_at: now,
    })

    const enrichedConfig = enrichAgentConfigFromWorkspace(newConfig)

    return NextResponse.json({
      success: true,
      agent: { ...agent, config: enrichedConfig, role: role || agent.role, updated_at: now },
    })
  } catch (error: any) {
    logger.error({ err: error }, 'PUT /api/agents/[id] error')
    return NextResponse.json({ error: error.message || 'Failed to update agent' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id] - Delete an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1;

    let agent: Agent | undefined
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as Agent | undefined
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as Agent | undefined
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    db.prepare('DELETE FROM agents WHERE id = ? AND workspace_id = ?').run(agent.id, workspaceId)

    db_helpers.logActivity(
      'agent_deleted',
      'agent',
      agent.id,
      auth.user.username,
      `Deleted agent: ${agent.name}`,
      { name: agent.name, role: agent.role },
      workspaceId
    )

    eventBus.broadcast('agent.deleted', { id: agent.id, name: agent.name })

    return NextResponse.json({ success: true, deleted: agent.name })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/agents/[id] error')
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
