import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { selfRegisterLimiter } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
const VALID_ROLES = ['coder', 'reviewer', 'tester', 'devops', 'researcher', 'assistant', 'agent']

/**
 * POST /api/agents/register — Agent self-registration.
 *
 * Allows agents to register themselves with minimal auth (viewer role).
 * If an agent with the same name already exists, returns the existing agent
 * (idempotent upsert on status/last_seen).
 *
 * Body: { name, role?, capabilities?, framework? }
 *
 * Rate-limited to 5 registrations/min per IP to prevent spam.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = selfRegisterLimiter(request)
  if (limited) return limited

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const role = typeof body?.role === 'string' ? body.role.trim() : 'agent'
  const capabilities = Array.isArray(body?.capabilities) ? body.capabilities.filter((c: any) => typeof c === 'string') : []
  const framework = typeof body?.framework === 'string' ? body.framework.trim() : null

  if (!name || !NAME_RE.test(name)) {
    return NextResponse.json({
      error: 'Invalid agent name. Use 1-63 alphanumeric characters, dots, hyphens, or underscores. Must start with alphanumeric.',
    }, { status: 400 })
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({
      error: `Invalid role. Use: ${VALID_ROLES.join(', ')}`,
    }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)

    // Check if agent already exists — idempotent: update last_seen and status
    const existing = db.prepare(
      'SELECT * FROM agents WHERE name = ? AND workspace_id = ?'
    ).get(name, workspaceId) as any | undefined

    if (existing) {
      db.prepare(
        'UPDATE agents SET status = ?, last_seen = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
      ).run('idle', now, now, existing.id, workspaceId)

      return NextResponse.json({
        agent: {
          id: existing.id,
          name: existing.name,
          role: existing.role,
          status: 'idle',
          created_at: existing.created_at,
        },
        registered: false,
        message: 'Agent already registered, status updated',
      })
    }

    // Create new agent
    const config: Record<string, any> = {}
    if (capabilities.length > 0) config.capabilities = capabilities
    if (framework) config.framework = framework

    const result = db.prepare(`
      INSERT INTO agents (name, role, status, config, created_at, updated_at, last_seen, workspace_id)
      VALUES (?, ?, 'idle', ?, ?, ?, ?, ?)
    `).run(name, role, JSON.stringify(config), now, now, now, workspaceId)

    const agentId = Number(result.lastInsertRowid)

    db_helpers.logActivity(
      'agent_created',
      'agent',
      agentId,
      name,
      `Agent self-registered: ${name} (${role})${framework ? ` via ${framework}` : ''}`,
      { name, role, framework, capabilities, self_registered: true },
      workspaceId,
    )

    logAuditEvent({
      action: 'agent_self_register',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'agent',
      target_id: agentId,
      detail: { name, role, framework, self_registered: true },
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    })

    eventBus.broadcast('agent.created', { id: agentId, name, role, status: 'idle', workspace_id: workspaceId })

    return NextResponse.json({
      agent: {
        id: agentId,
        name,
        role,
        status: 'idle',
        created_at: now,
      },
      registered: true,
      message: 'Agent registered successfully',
    }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      // Race condition — another request registered the same name
      return NextResponse.json({ error: 'Agent name already exists' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/agents/register error')
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
