/**
 * Integration API — slim route handler.
 * All registry data, types, helpers, and sub-handlers live in @/lib/integrations-registry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { validateBody, integrationActionSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { getPluginIntegrations } from '@/lib/plugins'
import {
  buildIntegrationList,
  handleTest,
  handlePull,
  handlePullAll,
  readEnvFile,
  writeEnvFile,
  isVarBlocked,
  INTEGRATIONS,
} from '@/lib/integrations-registry'

// ---------------------------------------------------------------------------
// GET /api/integrations — list all integrations with status + redacted values
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const result = await buildIntegrationList()
  // buildIntegrationList returns NextResponse on error, or data object on success
  if (result instanceof NextResponse) return result
  return NextResponse.json(result)
}

// ---------------------------------------------------------------------------
// PUT /api/integrations — update/add env vars
// Body: { vars: { KEY: "value", ... } }
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const limited = mutationLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.vars || typeof body.vars !== 'object') {
    return NextResponse.json({ error: 'vars object required' }, { status: 400 })
  }

  for (const key of Object.keys(body.vars)) {
    if (isVarBlocked(key)) {
      return NextResponse.json({ error: `Cannot set protected variable: ${key}` }, { status: 403 })
    }
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      return NextResponse.json({ error: `Invalid variable name: ${key}` }, { status: 400 })
    }
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
  }

  const { lines } = envData
  const updatedKeys: string[] = []

  for (const [key, value] of Object.entries(body.vars)) {
    const strValue = String(value)
    const existing = lines.find(l => l.type === 'var' && l.key === key)
    if (existing) {
      existing.value = strValue
    } else {
      if (lines.length > 0 && lines[lines.length - 1].type !== 'blank') {
        lines.push({ type: 'blank', raw: '' })
      }
      lines.push({ type: 'var', raw: `${key}=${strValue}`, key, value: strValue })
    }
    updatedKeys.push(key)
  }

  await writeEnvFile(lines)

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'integrations_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updatedKeys },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated: updatedKeys, count: updatedKeys.length })
}

// ---------------------------------------------------------------------------
// DELETE /api/integrations?keys=KEY1,KEY2 — remove env vars
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const limited = mutationLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const keysParam = searchParams.get('keys')
  if (!keysParam) {
    return NextResponse.json({ error: 'keys parameter required (comma-separated string or array)' }, { status: 400 })
  }

  const keysToRemove = new Set<string>(keysParam.split(',').map((k: string) => k.trim()).filter(Boolean))
  if (keysToRemove.size === 0) {
    return NextResponse.json({ error: 'At least one key required' }, { status: 400 })
  }

  for (const key of keysToRemove) {
    if (isVarBlocked(key)) {
      return NextResponse.json({ error: `Cannot remove protected variable: ${key}` }, { status: 403 })
    }
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
  }

  const removed: string[] = []
  const newLines = envData.lines.filter(l => {
    if (l.type === 'var' && l.key && keysToRemove.has(l.key)) {
      removed.push(l.key)
      return false
    }
    return true
  })

  if (removed.length > 0) {
    await writeEnvFile(newLines)
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'integrations_remove',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { removed_keys: removed },
    ip_address: ipAddress,
  })

  return NextResponse.json({ removed, count: removed.length })
}

// ---------------------------------------------------------------------------
// POST /api/integrations — action dispatcher (test, pull, pull-all)
// Body: { action: "test"|"pull"|"pull-all", integrationId?: "..." }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, integrationActionSchema)
  if ('error' in result) return result.error
  const body = result.data

  if (body.action === 'pull-all') {
    return handlePullAll(request, auth.user, body.category)
  }

  if (!body.integrationId) {
    return NextResponse.json({ error: 'integrationId required' }, { status: 400 })
  }

  let integration = INTEGRATIONS.find(i => i.id === body.integrationId)
  if (!integration) {
    const pi = getPluginIntegrations().find(i => i.id === body.integrationId)
    if (pi) {
      integration = {
        id: pi.id, name: pi.name, category: pi.category,
        envVars: pi.envVars, vaultItem: pi.vaultItem,
        testable: pi.testable, recommendation: pi.recommendation,
      }
    }
  }
  if (!integration) {
    return NextResponse.json({ error: `Unknown integration: ${body.integrationId}` }, { status: 404 })
  }

  if (body.action === 'test') return handleTest(integration, request, auth.user)
  if (body.action === 'pull') return handlePull(integration, request, auth.user)

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
}
