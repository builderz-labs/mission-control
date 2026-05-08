import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db_helpers } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { enforceExecutionGate } from '@/lib/enforcement/execution-gate-enforcer'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getDefaultProvider } from '@/lib/execution/providers/registry'
import { logExecutionEvent } from '@/lib/execution/execution-logger'

// Only allow alphanumeric, hyphens, and underscores in session IDs
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  // Execution gate: enforce for agent-initiated session control.
  if (auth.user.agent_name) {
    const gate = enforceExecutionGate({ agentId: auth.user.agent_name })
    if (!gate.allowed) return gate.response
  }

  try {
    const { id } = await params
    const { action } = await request.json()

    if (!SESSION_ID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      )
    }

    if (!['monitor', 'pause', 'terminate'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: monitor, pause, terminate' },
        { status: 400 }
      )
    }

    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) {
      return wsResult.response
    }

    const provider = getDefaultProvider()
    const workspaceId = wsResult.workspaceId
    const startedAt = Date.now()

    let providerResult: Awaited<ReturnType<typeof provider.kill | typeof provider.send>>
    if (action === 'terminate') {
      providerResult = await provider.kill(id)
    } else {
      const message = action === 'monitor'
        ? { type: 'control', action: 'monitor' }
        : { type: 'control', action: 'pause' }
      providerResult = await provider.send(id, message)
    }

    const duration_ms = Date.now() - startedAt

    if (!providerResult.ok) {
      logger.error({ err: providerResult.error }, 'Session control error')
      logExecutionEvent({
        event_type: 'execution_failure',
        provider_id: provider.id,
        workspace_id: workspaceId,
        session_key: id,
        duration_ms,
        success: false,
        error_code: providerResult.error.code,
        detail: { action, message: providerResult.error.message },
      })
      return NextResponse.json(
        { error: providerResult.error.message || 'Session control failed' },
        { status: 500 }
      )
    }

    logExecutionEvent({
      event_type: 'dispatch_completed',
      provider_id: provider.id,
      workspace_id: workspaceId,
      session_key: id,
      duration_ms,
      success: true,
      detail: { action },
    })

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Session ${action}: ${id}`,
      { session_key: id, action }
    )

    return NextResponse.json({
      success: true,
      action,
      session: id,
      result: providerResult.data,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'Session control error')
    return NextResponse.json(
      { error: error.message || 'Session control failed' },
      { status: 500 }
    )
  }
}
