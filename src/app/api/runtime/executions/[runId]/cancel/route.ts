import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { OpenClawRuntimeError, cancelExecution } from '@/lib/openclaw-runtime'

const cancelSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  runtime_session_id: z.string().trim().min(1).max(200).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {} // Allow empty body for cancellation
  }

  const parsedBody = cancelSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsedBody.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
      { status: 400 },
    )
  }

  const resolvedParams = await params
  const runId = resolvedParams.runId?.trim()
  if (!runId) {
    return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const result = cancelExecution(db, {
      runId,
      reason: parsedBody.data.reason,
      runtimeSessionId: parsedBody.data.runtime_session_id,
      workspaceId,
      actor: auth.user.username,
      actorId: auth.user.id,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    if (error instanceof OpenClawRuntimeError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      )
    }

    logger.error({ err: error, runId }, 'POST /api/runtime/executions/[runId]/cancel error')
    return NextResponse.json({ error: 'Failed to cancel execution' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
