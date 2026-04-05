import { getErrorMessage } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

interface PatchBody {
  priority?: number
  enabled?: number
  max_retries?: number
  timeout_ms?: number
  capability_tags?: string[]
}

interface RoutingRule {
  id: number
  provider: string
  priority: number
  enabled: number
  max_retries: number
  timeout_ms: number
  capability_tags: string
  workspace_id: number
  created_at: number
  updated_at: number
}

/**
 * PATCH /api/providers/routing/[id]
 * Partially updates a routing rule. Only supplied fields are modified.
 * Admin only — used by the ProviderFailoverPanel for inline edits.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()

  const { id: rawId } = await params
  const id = Number(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  // Verify row exists and belongs to this workspace
  const existing = db
    .prepare('SELECT id FROM provider_routing_rules WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId)
  if (!existing) return NextResponse.json({ error: 'Routing rule not found' }, { status: 404 })

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Build SET clause only for provided fields
  const setClauses: string[] = ['updated_at = unixepoch()']
  const values: (string | number)[] = []

  if (body.priority !== undefined) {
    setClauses.push('priority = ?')
    values.push(body.priority)
  }
  if (body.enabled !== undefined) {
    setClauses.push('enabled = ?')
    values.push(body.enabled)
  }
  if (body.max_retries !== undefined) {
    setClauses.push('max_retries = ?')
    values.push(body.max_retries)
  }
  if (body.timeout_ms !== undefined) {
    setClauses.push('timeout_ms = ?')
    values.push(body.timeout_ms)
  }
  if (body.capability_tags !== undefined) {
    setClauses.push('capability_tags = ?')
    values.push(JSON.stringify(Array.isArray(body.capability_tags) ? body.capability_tags : []))
  }

  if (setClauses.length === 1) {
    // Only updated_at — nothing to do
    return NextResponse.json({ ok: true })
  }

  try {
    db.prepare(
      `UPDATE provider_routing_rules SET ${setClauses.join(', ')} WHERE id = ? AND workspace_id = ?`,
    ).run(...values, id, workspaceId)

    const updated = db
      .prepare(
        `SELECT id, provider, priority, enabled, max_retries, timeout_ms,
                capability_tags, workspace_id, created_at, updated_at
         FROM provider_routing_rules WHERE id = ?`,
      )
      .get(id) as RoutingRule

    return NextResponse.json({
      rule: {
        ...updated,
        capability_tags: safeParseJson(updated.capability_tags, []),
      },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to update routing rule: ${getErrorMessage(err)}` },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/providers/routing/[id]
 * Removes a routing rule by id. Admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()

  const { id: rawId } = await params
  const id = Number(rawId)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const result = db
      .prepare('DELETE FROM provider_routing_rules WHERE id = ? AND workspace_id = ?')
      .run(id, workspaceId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Routing rule not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, deleted: id })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to delete routing rule: ${getErrorMessage(err)}` },
      { status: 500 },
    )
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
