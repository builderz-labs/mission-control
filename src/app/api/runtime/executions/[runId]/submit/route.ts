import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { OpenClawRuntimeError, submitExecutionResult } from '@/lib/openclaw-runtime'

const artifactSchema = z.object({
  type: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(500),
  path: z.string().trim().max(2000).optional(),
  content: z.string().max(100_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const logSchema = z.object({
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string().trim().min(1).max(10_000),
  timestamp: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const submitSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  outcome: z.enum(['success', 'failure', 'error', 'timeout', 'cancelled']).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(artifactSchema).max(100).default([]),
  logs: z.array(logSchema).max(1000).default([]),
  error: z.string().max(10_000).optional(),
  runtime_node_id: z.string().trim().min(1).max(200).optional(),
  runtime_session_id: z.string().trim().min(1).max(200).optional(),
  auto_validate: z.boolean().optional(),
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
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const parsedBody = submitSchema.safeParse(body)
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
    const result = submitExecutionResult(db, {
      runId,
      status: parsedBody.data.status,
      outcome: parsedBody.data.outcome,
      result: parsedBody.data.result,
      artifacts: parsedBody.data.artifacts,
      logs: parsedBody.data.logs,
      error: parsedBody.data.error,
      runtimeNodeId: parsedBody.data.runtime_node_id,
      runtimeSessionId: parsedBody.data.runtime_session_id,
      auto_validate: parsedBody.data.auto_validate,
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

    logger.error({ err: error, runId }, 'POST /api/runtime/executions/[runId]/submit error')
    return NextResponse.json({ error: 'Failed to submit execution result' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
