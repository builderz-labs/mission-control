import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import {
  observe,
  observeSync,
  recall,
  reflect,
  recordRelationship,
  consolidateEpisode,
  getTimeline,
  getMemoryStats,
} from '@/lib/agent-memory'

const observeSchema = z.object({
  description: z.string().min(1, 'Description is required').max(5000),
  relatedAgentId: z.number().int().positive().optional(),
  importance: z.number().int().min(0).max(9).optional(),
})

const recallSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000),
  topK: z.number().int().min(1).max(50).default(5),
})

const reflectSchema = z.object({}).optional()

const relationshipSchema = z.object({
  targetAgentId: z.number().int().positive(),
  description: z.string().min(1).max(2000),
  importance: z.number().int().min(0).max(9).default(5),
})

const consolidateSchema = z.object({
  memoryIds: z.array(z.number().int().positive()).min(2, 'At least 2 memory IDs required'),
})

function resolveAgentId(db: ReturnType<typeof getDatabase>, agentIdParam: string, workspaceId: number): number | null {
  if (!isNaN(Number(agentIdParam))) {
    const row = db.prepare('SELECT id FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentIdParam), workspaceId) as { id: number } | undefined
    return row?.id ?? null
  }
  const row = db.prepare('SELECT id FROM agents WHERE name = ? AND workspace_id = ?').get(agentIdParam, workspaceId) as { id: number } | undefined
  return row?.id ?? null
}

/**
 * GET /api/agents/[id]/memories — Timeline view or stats.
 * Query params: action=timeline|stats|recall, type, limit, offset, query, topK
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const resolvedParams = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agentId = resolveAgentId(db, resolvedParams.id, workspaceId)

  if (!agentId) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'timeline'

  try {
    if (action === 'stats') {
      const stats = getMemoryStats(agentId, workspaceId)
      return NextResponse.json(stats)
    }

    if (action === 'recall') {
      const query = searchParams.get('query')
      if (!query) return NextResponse.json({ error: 'query param required' }, { status: 400 })
      const topK = Math.min(Number(searchParams.get('topK') ?? '5'), 50)
      const results = recall(agentId, query, workspaceId, topK)
      return NextResponse.json({ results })
    }

    // Default: timeline
    const type = searchParams.get('type') ?? undefined
    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
    const offset = Number(searchParams.get('offset') ?? '0')
    const timeline = getTimeline(agentId, workspaceId, { type, limit, offset })
    return NextResponse.json({ memories: timeline })
  } catch (err) {
    logger.error({ err, agentId }, 'GET /api/agents/[id]/memories error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents/[id]/memories — Multi-action endpoint.
 * Body must include { action: 'observe' | 'recall' | 'reflect' | 'relationship' | 'consolidate', ...data }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()
  const resolvedParams = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agentId = resolveAgentId(db, resolvedParams.id, workspaceId)

  if (!agentId) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action as string
  if (!action) {
    return NextResponse.json(
      { error: 'action field required (observe|recall|reflect|relationship|consolidate)' },
      { status: 400 },
    )
  }

  try {
    switch (action) {
      case 'observe': {
        const result = observeSchema.safeParse(body)
        if (!result.success) {
          return NextResponse.json({ error: 'Validation failed', details: result.error.issues }, { status: 400 })
        }
        const { description, relatedAgentId, importance } = result.data

        let memoryId: number
        if (importance !== undefined) {
          memoryId = observeSync(agentId, description, importance, workspaceId, relatedAgentId)
        } else {
          memoryId = await observe(agentId, description, workspaceId, relatedAgentId)
        }

        eventBus.broadcast('activity.created' as any, {
          type: 'agent.memory.observe',
          agentId,
          memoryId,
        })

        return NextResponse.json({ memoryId }, { status: 201 })
      }

      case 'recall': {
        const result = recallSchema.safeParse(body)
        if (!result.success) {
          return NextResponse.json({ error: 'Validation failed', details: result.error.issues }, { status: 400 })
        }
        const results = recall(agentId, result.data.query, workspaceId, result.data.topK)
        return NextResponse.json({ results })
      }

      case 'reflect': {
        const reflectionIds = await reflect(agentId, workspaceId)
        eventBus.broadcast('activity.created' as any, {
          type: 'agent.memory.reflect',
          agentId,
          reflectionIds,
        })
        return NextResponse.json({ reflectionIds })
      }

      case 'relationship': {
        const result = relationshipSchema.safeParse(body)
        if (!result.success) {
          return NextResponse.json({ error: 'Validation failed', details: result.error.issues }, { status: 400 })
        }
        const memoryId = recordRelationship(
          agentId,
          result.data.targetAgentId,
          result.data.description,
          result.data.importance,
          workspaceId,
        )
        return NextResponse.json({ memoryId }, { status: 201 })
      }

      case 'consolidate': {
        const result = consolidateSchema.safeParse(body)
        if (!result.success) {
          return NextResponse.json({ error: 'Validation failed', details: result.error.issues }, { status: 400 })
        }
        const memoryId = await consolidateEpisode(agentId, result.data.memoryIds, workspaceId)
        return NextResponse.json({ memoryId }, { status: 201 })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Valid: observe, recall, reflect, relationship, consolidate` },
          { status: 400 },
        )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Memory operation failed'
    logger.error({ err, agentId, action }, 'POST /api/agents/[id]/memories error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
