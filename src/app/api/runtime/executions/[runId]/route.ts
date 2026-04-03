import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { OpenClawRuntimeError, getExecutionStatus } from '@/lib/openclaw-runtime'

const querySchema = z.object({
  runtime_session_id: z.string().trim().min(1).max(200).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params
  const runId = resolvedParams.runId?.trim()
  if (!runId) {
    return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
  }

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const queryResult = querySchema.safeParse({
    runtime_session_id: searchParams.get('runtime_session_id') ?? undefined,
  })
  if (!queryResult.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: queryResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const result = getExecutionStatus(db, {
      runId,
      runtimeSessionId: queryResult.data.runtime_session_id,
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

    logger.error({ err: error, runId }, 'GET /api/runtime/executions/[runId] error')
    return NextResponse.json({ error: 'Failed to get execution status' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
