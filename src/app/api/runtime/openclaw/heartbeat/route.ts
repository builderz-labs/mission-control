import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { agentHeartbeatLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { OpenClawRuntimeError, recordOpenClawHeartbeat } from '@/lib/openclaw-runtime'

const heartbeatSchema = z.object({
  agent_id: z.string().trim().min(1).max(100),
  runtime_node_id: z.string().trim().min(1).max(200),
  runtime_session_id: z.string().trim().min(1).max(200),
  runtime_type: z.literal('openclaw').optional(),
  node_status: z.enum(['online', 'offline', 'busy', 'idle']),
  current_load: z.number().int().min(0).max(1_000).optional(),
  max_concurrency: z.number().int().min(0).max(1_000).optional(),
  queue_lag: z.number().int().min(0).max(1_000_000).optional(),
  capability_tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = agentHeartbeatLimiter(request)
  if (rateCheck) return rateCheck

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const parsedBody = heartbeatSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsedBody.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const result = recordOpenClawHeartbeat(db, {
      agentId: parsedBody.data.agent_id,
      runtimeType: parsedBody.data.runtime_type,
      runtimeNodeId: parsedBody.data.runtime_node_id,
      runtimeSessionId: parsedBody.data.runtime_session_id,
      nodeStatus: parsedBody.data.node_status,
      currentLoad: parsedBody.data.current_load,
      maxConcurrency: parsedBody.data.max_concurrency,
      queueLag: parsedBody.data.queue_lag,
      capabilityTags: parsedBody.data.capability_tags,
      metadata: parsedBody.data.metadata,
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

    logger.error({ err: error }, 'POST /api/runtime/openclaw/heartbeat error')
    return NextResponse.json({ error: 'Failed to record heartbeat' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
