import { NextRequest, NextResponse } from 'next/server'
import { ROLE_LEVELS, requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { parsePermissionMode } from '@/lib/permission-connector'
import { loadSettingValue, permissionModeKey, saveSettingValue } from '@/lib/chat-settings-kv'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

function canSetMode(role: string): boolean {
  return (ROLE_LEVELS[role] ?? -1) >= ROLE_LEVELS.operator
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'chat_layout', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  try {
    if (!canSetMode(auth.user.role)) {
      return NextResponse.json({ mode: 'ask', allowed: false })
    }
    const stored = parsePermissionMode(loadSettingValue(permissionModeKey(auth.user.id)))
    return NextResponse.json({ mode: stored, allowed: true })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/permission-mode error')
    return NextResponse.json({ error: 'Failed to load permission mode' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'chat_layout', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({})) as { mode?: unknown }
    const allowed = new Set([
      'ask', 'auto', 'accept_edits', 'plan', 'bypass',
      'default', 'manual', 'acceptEdits', 'bypassPermissions',
    ])
    if (typeof body.mode !== 'string' || !allowed.has(body.mode)) {
      return NextResponse.json({ error: 'mode must be a supported permission mode' }, { status: 400 })
    }
    const mode = parsePermissionMode(body.mode)
    const key = permissionModeKey(auth.user.id)
    const from = parsePermissionMode(loadSettingValue(key))
    saveSettingValue(key, mode, 'Per-user chat permission mode', auth.user.username)
    logAuditEvent({
      action: 'chat.permission_mode',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'chat',
      detail: { from, to: mode },
    })
    return NextResponse.json({ ok: true, mode, allowed: true })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/chat/permission-mode error')
    return NextResponse.json({ error: 'Failed to save permission mode' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
