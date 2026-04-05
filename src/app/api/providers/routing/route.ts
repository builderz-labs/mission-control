import { getErrorMessage } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

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

interface UpsertBody {
  provider: string
  priority?: number
  enabled?: number
  max_retries?: number
  timeout_ms?: number
  capability_tags?: string[]
}

/**
 * GET /api/providers/routing
 * Lists all routing rules for the workspace, ordered by priority ascending.
 * Admin only — used by the ProviderFailoverPanel to render the routing table.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()

  try {
    const rules = db
      .prepare(
        `SELECT id, provider, priority, enabled, max_retries, timeout_ms,
                capability_tags, workspace_id, created_at, updated_at
         FROM provider_routing_rules
         WHERE workspace_id = ?
         ORDER BY priority ASC`,
      )
      .all(workspaceId) as RoutingRule[]

    const parsed = rules.map((r) => ({
      ...r,
      // capability_tags is stored as a JSON array string
      capability_tags: safeParseJson(r.capability_tags, []),
    }))

    return NextResponse.json({ rules: parsed })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to fetch routing rules: ${getErrorMessage(err)}` },
      { status: 500 },
    )
  }
}

/**
 * POST /api/providers/routing
 * Upserts a routing rule by (provider, workspace_id).
 * Automatically assigns the next available priority when not provided.
 * Admin only.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()

  let body: UpsertBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.provider || typeof body.provider !== 'string' || !body.provider.trim()) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }

  const provider = body.provider.trim().toLowerCase()

  // Determine next priority when not supplied
  const priority = body.priority ?? nextPriority(db, workspaceId)
  const enabled = body.enabled ?? 1
  const maxRetries = body.max_retries ?? 2
  const timeoutMs = body.timeout_ms ?? 30000
  const capabilityTags = JSON.stringify(
    Array.isArray(body.capability_tags) ? body.capability_tags : [],
  )

  try {
    db.prepare(
      `INSERT OR REPLACE INTO provider_routing_rules
         (provider, priority, enabled, max_retries, timeout_ms, capability_tags, workspace_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run(provider, priority, enabled, maxRetries, timeoutMs, capabilityTags, workspaceId)

    const rule = db
      .prepare(
        `SELECT id, provider, priority, enabled, max_retries, timeout_ms,
                capability_tags, workspace_id, created_at, updated_at
         FROM provider_routing_rules
         WHERE provider = ? AND workspace_id = ?`,
      )
      .get(provider, workspaceId) as RoutingRule

    return NextResponse.json({
      rule: { ...rule, capability_tags: safeParseJson(rule.capability_tags, []) },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to upsert routing rule: ${getErrorMessage(err)}` },
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

/** Returns max(priority) + 1 for the workspace, starting at 0 when empty. */
function nextPriority(db: ReturnType<typeof getDatabase>, workspaceId: number): number {
  const row = db
    .prepare('SELECT MAX(priority) as max_p FROM provider_routing_rules WHERE workspace_id = ?')
    .get(workspaceId) as { max_p: number | null }
  return (row.max_p ?? -1) + 1
}
