import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { recordExecutionProgress, OpenClawRuntimeError } from '@/lib/openclaw-runtime'
import { logger } from '@/lib/logger'

const progressSchema = z.object({
  progress: z.number().int().min(0).max(100),
  message: z.string().trim().max(500).nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).nullable().optional(),
  runtime_node_id: z.string().trim().min(1).max(200).nullable().optional(),
  runtime_session_id: z.string().trim().min(1).max(200).nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const parsedBody = progressSchema.safeParse(body)
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
  const runId = resolvedParams.runId
  if (!runId || runId.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const result = recordExecutionProgress(db, {
      runId,
      progress: parsedBody.data.progress,
      message: parsedBody.data.message ?? null,
      metrics: parsedBody.data.metrics ?? {},
      runtimeNodeId: parsedBody.data.runtime_node_id ?? null,
      runtimeSessionId: parsedBody.data.runtime_session_id ?? null,
      workspaceId,
      actor: auth.user.username,
      actorId: auth.user.id,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true, data: result }, { status: 200 })
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

    logger.error({ err: error, runId }, 'POST /api/runtime/executions/[runId]/progress error')
    return NextResponse.json({ error: 'Failed to record progress' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
