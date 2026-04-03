import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { claimDispatch, OpenClawRuntimeError } from '@/lib/openclaw-runtime'
import { logger } from '@/lib/logger'

const claimSchema = z.object({
  agent_id: z.string().trim().min(1).max(100),
  runtime_node_id: z.string().trim().min(1).max(200),
  runtime_session_id: z.string().trim().min(1).max(200),
  capability_tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dispatchId: string }> },
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

  const parsedBody = claimSchema.safeParse(body)
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
  const dispatchId = Number.parseInt(resolvedParams.dispatchId, 10)
  if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const result = claimDispatch(db, {
      dispatchId,
      agentId: parsedBody.data.agent_id,
      runtimeNodeId: parsedBody.data.runtime_node_id,
      runtimeSessionId: parsedBody.data.runtime_session_id,
      capabilityTags: parsedBody.data.capability_tags,
      workspaceId,
      actor: auth.user.username,
      actorId: auth.user.id,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true, data: result }, { status: 201 })
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

    logger.error({ err: error, dispatchId }, 'POST /api/runtime/openclaw/dispatches/[dispatchId]/claim error')
    return NextResponse.json({ error: 'Failed to claim dispatch' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
