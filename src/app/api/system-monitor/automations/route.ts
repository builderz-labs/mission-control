import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { heavyLimiter } from '@/lib/rate-limit'
import { validateBody, macCleanupTriggerSchema } from '@/lib/validation'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { buildMacCleanupSnapshot, collectAndRun } from '@/lib/mac-cleanup'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(
    auth.user,
    'host_administration',
    new URL(request.url).pathname,
  )
  if (isolationDeny) return isolationDeny

  const snapshot = await buildMacCleanupSnapshot()
  return NextResponse.json(snapshot)
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(
    auth.user,
    'host_administration',
    new URL(request.url).pathname,
  )
  if (isolationDeny) return isolationDeny

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, macCleanupTriggerSchema)
  if ('error' in parsed) return parsed.error

  const result = await collectAndRun(parsed.data.id, parsed.data.mode, 'manual')
  if (parsed.data.mode === 'auto') {
    logAuditEvent({
      action: 'mac_cleanup_trigger',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: {
        id: parsed.data.id,
        mode: parsed.data.mode,
        ok: result.ok,
        code: result.decision.code,
      },
    })
  }
  const failedAfterAllow = result.decision.allowed && !result.ok
  return NextResponse.json(result, { status: failedAfterAllow ? 500 : 200 })
}
