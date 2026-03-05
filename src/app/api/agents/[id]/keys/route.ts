import { createHash, randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const ALLOWED_SCOPES = new Set([
  'viewer',
  'operator',
  'admin',
  'agent:self',
  'agent:diagnostics',
  'agent:attribution',
  'agent:heartbeat',
  'agent:messages',
])

interface AgentRow {
  id: number
  name: string
  workspace_id: number
}

interface AgentKeyRow {
  id: number
  name: string
  key_prefix: string
  scopes: string
  created_by: string | null
  expires_at: number | null
  revoked_at: number | null
  last_used_at: number | null
  created_at: number
  updated_at: number
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

function resolveAgent(db: ReturnType<typeof getDatabase>, idParam: string, workspaceId: number): AgentRow | null {
  if (/^\d+$/.test(idParam)) {
    return (db
      .prepare(`SELECT id, name, workspace_id FROM agents WHERE id = ? AND workspace_id = ?`)
      .get(Number(idParam), workspaceId) as AgentRow | undefined) || null
  }

  return (db
    .prepare(`SELECT id, name, workspace_id FROM agents WHERE name = ? AND workspace_id = ?`)
    .get(idParam, workspaceId) as AgentRow | undefined) || null
}

function parseScopes(rawScopes: unknown): string[] {
  const fallback = ['viewer', 'agent:self']
  if (!Array.isArray(rawScopes)) return fallback

  const scopes = rawScopes
    .map((scope) => String(scope).trim())
    .filter((scope) => scope.length > 0 && ALLOWED_SCOPES.has(scope))

  if (scopes.length === 0) return fallback
  return Array.from(new Set(scopes))
}

function parseExpiry(body: any): number | null {
  if (body?.expires_at != null) {
    const value = Number(body.expires_at)
    if (!Number.isInteger(value) || value <= 0) throw new Error('expires_at must be a future unix timestamp')
    return value
  }

  if (body?.expires_in_days != null) {
    const days = Number(body.expires_in_days)
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw new Error('expires_in_days must be between 1 and 3650')
    }
    return Math.floor(Date.now() / 1000) + Math.floor(days * 24 * 60 * 60)
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolved = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const agent = resolveAgent(db, resolved.id, workspaceId)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const rows = db
      .prepare(`
        SELECT id, name, key_prefix, scopes, created_by, expires_at, revoked_at, last_used_at, created_at, updated_at
        FROM agent_api_keys
        WHERE agent_id = ? AND workspace_id = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(agent.id, workspaceId) as AgentKeyRow[]

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      keys: rows.map((row) => ({
        ...row,
        scopes: (() => {
          try {
            const parsed = JSON.parse(row.scopes)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })(),
      })),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/keys error')
    return NextResponse.json({ error: 'Failed to list agent API keys' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolved = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const agent = resolveAgent(db, resolved.id, workspaceId)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const name = String(body?.name || 'default').trim().slice(0, 128)
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    let expiresAt: number | null = null
    try {
      expiresAt = parseExpiry(body)
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 })
    }

    const scopes = parseScopes(body?.scopes)
    const now = Math.floor(Date.now() / 1000)
    const rawKey = `mca_${randomBytes(24).toString('hex')}`
    const keyHash = hashApiKey(rawKey)
    const keyPrefix = rawKey.slice(0, 12)

    const result = db
      .prepare(`
        INSERT INTO agent_api_keys (
          agent_id, workspace_id, name, key_hash, key_prefix, scopes, expires_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        agent.id,
        workspaceId,
        name,
        keyHash,
        keyPrefix,
        JSON.stringify(scopes),
        expiresAt,
        auth.user.username,
        now,
        now,
      )

    return NextResponse.json(
      {
        key: {
          id: Number(result.lastInsertRowid),
          name,
          key_prefix: keyPrefix,
          scopes,
          expires_at: expiresAt,
          created_at: now,
        },
        api_key: rawKey,
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/keys error')
    return NextResponse.json({ error: 'Failed to create agent API key' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolved = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const agent = resolveAgent(db, resolved.id, workspaceId)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const keyId = Number(body?.key_id)
    if (!Number.isInteger(keyId) || keyId <= 0) {
      return NextResponse.json({ error: 'key_id must be a positive integer' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)
    const result = db
      .prepare(`
        UPDATE agent_api_keys
        SET revoked_at = ?, updated_at = ?
        WHERE id = ? AND agent_id = ? AND workspace_id = ? AND revoked_at IS NULL
      `)
      .run(now, now, keyId, agent.id, workspaceId)

    if (result.changes < 1) {
      return NextResponse.json({ error: 'Active key not found for this agent' }, { status: 404 })
    }

    return NextResponse.json({ success: true, key_id: keyId, revoked_at: now })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/agents/[id]/keys error')
    return NextResponse.json({ error: 'Failed to revoke agent API key' }, { status: 500 })
  }
}
