import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { selfImprovingEngine } from '@/lib/self-improving'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { z } from 'zod'

/** Valid values for the suggestion status query parameter */
const VALID_SUGGESTION_STATUSES = new Set(['pending', 'accepted', 'rejected', 'implemented'])

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const recordPerformanceSchema = z.object({
  type: z.literal('performance'),
  operation_name: z.string().min(1).max(200),
  duration_ms: z.number().positive(),
})

const recordCostSchema = z.object({
  type: z.literal('cost'),
  agent_id: z.string().min(1).max(200),
  task_type: z.string().max(200).optional(),
  model_name: z.string().max(200).optional(),
  token_input: z.number().int().min(0),
  token_output: z.number().int().min(0),
  duration_ms: z.number().int().positive().optional(),
  quality_score: z.number().min(0).max(1).optional(),
})

const updateSuggestionSchema = z.object({
  type: z.literal('suggestion_update'),
  suggestion_id: z.number().int().positive(),
  status: z.enum(['accepted', 'rejected', 'implemented']),
})

const generateSuggestionsSchema = z.object({
  type: z.literal('generate_suggestions'),
})

const compareApproachesSchema = z.object({
  type: z.literal('compare_approaches'),
  task_type: z.string().min(1).max(200),
})

const postBodySchema = z.discriminatedUnion('type', [
  recordPerformanceSchema,
  recordCostSchema,
  updateSuggestionSchema,
  generateSuggestionsSchema,
  compareApproachesSchema,
])

// ---------------------------------------------------------------------------
// GET /api/improvements
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const limited = readLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view')

    if (view === 'baselines') {
      return NextResponse.json({
        data: selfImprovingEngine.getBaselines(workspaceId),
      })
    }

    if (view === 'suggestions') {
      const rawStatus = searchParams.get('status')
      // Validate status parameter against known values (H2)
      if (rawStatus && !VALID_SUGGESTION_STATUSES.has(rawStatus)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${[...VALID_SUGGESTION_STATUSES].join(', ')}` },
          { status: 400 }
        )
      }
      const status = rawStatus as 'pending' | 'accepted' | 'rejected' | 'implemented' | undefined
      return NextResponse.json({
        data: selfImprovingEngine.getSuggestions(workspaceId, status ?? undefined),
      })
    }

    if (view === 'quality') {
      return NextResponse.json({
        data: selfImprovingEngine.getQualityScores(workspaceId),
      })
    }

    if (view === 'costs') {
      return NextResponse.json({
        data: selfImprovingEngine.getCostByAgent(workspaceId),
      })
    }

    if (view === 'trend') {
      const metric = (searchParams.get('metric') || 'cost') as 'cost' | 'performance' | 'quality'
      const period = (searchParams.get('period') || 'weekly') as 'daily' | 'weekly' | 'monthly'
      return NextResponse.json({
        data: selfImprovingEngine.analyzeTrend(metric, period, workspaceId),
      })
    }

    const dashboard = selfImprovingEngine.getDashboard(workspaceId)
    return NextResponse.json({ data: dashboard })
  } catch (err) {
    logger.error({ err }, 'GET /api/improvements failed')
    return NextResponse.json(
      { error: 'Failed to fetch improvement data' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/improvements
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const limited = mutationLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const parsed = await validateBody(request, postBodySchema)
  if ('error' in parsed) return parsed.error

  const workspaceId = auth.user.workspace_id ?? 1
  const body = parsed.data

  try {
    const result = handlePostAction(body, workspaceId)
    return NextResponse.json({ data: result })
  } catch (err) {
    logger.error({ err }, 'POST /api/improvements failed')
    return NextResponse.json(
      { error: 'Failed to process improvement action' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// Action dispatcher (keeps POST handler small)
// ---------------------------------------------------------------------------

type PostBody = z.infer<typeof postBodySchema>

function handlePostAction(body: PostBody, workspaceId: number): unknown {
  switch (body.type) {
    case 'performance':
      return selfImprovingEngine.recordPerformance({
        operation_name: body.operation_name,
        duration_ms: body.duration_ms,
        workspace_id: workspaceId,
      })

    case 'cost':
      return selfImprovingEngine.recordCost({
        agent_id: body.agent_id,
        task_type: body.task_type,
        model_name: body.model_name,
        token_input: body.token_input,
        token_output: body.token_output,
        duration_ms: body.duration_ms,
        quality_score: body.quality_score,
        workspace_id: workspaceId,
      })

    case 'suggestion_update':
      return selfImprovingEngine.updateSuggestionStatus(
        body.suggestion_id,
        body.status,
        workspaceId,
      )

    case 'generate_suggestions':
      return selfImprovingEngine.generateSuggestions(workspaceId)

    case 'compare_approaches':
      return selfImprovingEngine.compareApproaches(body.task_type, workspaceId)
  }
}
