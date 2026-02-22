import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, logAuditEvent } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'
import { writeAgentToConfig } from '@/lib/agent-sync'
import { eventBus } from '@/lib/event-bus'

/**
 * GET /api/agents/[id] - Get a single agent by ID or name
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDatabase()
    const { id } = await params

    let agent
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(id)
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(id))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const parsed = {
      ...(agent as any),
      config: (agent as any).config ? JSON.parse((agent as any).config) : {},
    }

    return NextResponse.json({ agent: parsed })
  } catch (error) {
    console.error('GET /api/agents/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id] - Update agent config with optional gateway write-back
 *
 * Body: {
 *   role?: string
 *   gateway_config?: object   - OpenClaw agent config fields to update
 *   write_to_gateway?: boolean - If true, also write to openclaw.json
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
    const body = await request.json()
    const { role, gateway_config, write_to_gateway } = body

    let agent
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(id) as any
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(id)) as any
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

    values.push(agent.id)
    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    // Write back to openclaw.json if requested
    if (write_to_gateway && gateway_config) {
      try {
        const openclawId = existingConfig.openclawId || agent.name.toLowerCase().replace(/\s+/g, '-')

        // Build the config to write back (full OpenClaw format)
        const writeBack: any = { id: openclawId }
        if (gateway_config.model) writeBack.model = gateway_config.model
        if (gateway_config.identity) writeBack.identity = gateway_config.identity
        if (gateway_config.sandbox) writeBack.sandbox = gateway_config.sandbox
        if (gateway_config.tools) writeBack.tools = gateway_config.tools
        if (gateway_config.subagents) writeBack.subagents = gateway_config.subagents
        if (gateway_config.memorySearch) writeBack.memorySearch = gateway_config.memorySearch

        await writeAgentToConfig(writeBack)

        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
        logAuditEvent({
          action: 'agent_config_writeback',
          actor: auth.user.username,
          actor_id: auth.user.id,
          target_type: 'agent',
          target_id: agent.id,
          detail: { agent_name: agent.name, openclaw_id: openclawId, fields: Object.keys(gateway_config) },
          ip_address: ipAddress,
        })
      } catch (err: any) {
        // Config update succeeded in DB but gateway write failed
        return NextResponse.json({
          warning: `Agent updated in MC but gateway write failed: ${err.message}`,
          agent: { ...agent, config: newConfig, role: role || agent.role, updated_at: now },
        })
      }
    }

    // Log activity
    db_helpers.logActivity(
      'agent_config_updated',
      'agent',
      agent.id,
      auth.user.username,
      `Config updated for agent ${agent.name}${write_to_gateway ? ' (+ gateway)' : ''}`,
      { fields: Object.keys(gateway_config || {}), write_to_gateway }
    )

    // Broadcast update
    eventBus.broadcast('agent.updated', {
      id: agent.id,
      name: agent.name,
      config: newConfig,
      updated_at: now,
    })

    return NextResponse.json({
      success: true,
      agent: { ...agent, config: newConfig, role: role || agent.role, updated_at: now },
    })
  } catch (error: any) {
    console.error('PUT /api/agents/[id] error:', error)
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

    let agent
    if (isNaN(Number(id))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(id) as any
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(id)) as any
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id)

    db_helpers.logActivity(
      'agent_deleted',
      'agent',
      agent.id,
      auth.user.username,
      `Deleted agent: ${agent.name}`,
      { name: agent.name, role: agent.role }
    )

    eventBus.broadcast('agent.deleted', { id: agent.id, name: agent.name })

    return NextResponse.json({ success: true, deleted: agent.name })
  } catch (error) {
    console.error('DELETE /api/agents/[id] error:', error)
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
