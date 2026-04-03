import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  getLearningStats,
  getTopPatterns,
  getRecentFeedback,
  suggestPatterns,
  recordPattern,
  recordOrReinforcePattern,
  recordFeedback,
  recordExecutionTrace,
  refreshPatternUsage,
  markFeedbackApplied,
  applyDecay,
  isNovelProblem,
  findSimilarTraces,
} from '@/lib/self-learning'
import type { PatternOutcome } from '@/lib/self-learning'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const recordPatternSchema = z.object({
  action: z.literal('record_pattern'),
  patternType: z.string().min(1).max(200),
  triggerContext: z.string().min(1).max(5000),
  actionTaken: z.string().min(1).max(5000),
  outcome: z.enum(['success', 'failure', 'partial']),
  reinforce: z.boolean().optional(),
})

const recordFeedbackSchema = z.object({
  action: z.literal('record_feedback'),
  taskId: z.number().int().positive().optional(),
  patternId: z.number().int().positive().optional(),
  rating: z.number().int().min(1).max(5),
  correction: z.string().max(5000).optional(),
})

const recordTraceSchema = z.object({
  action: z.literal('record_trace'),
  taskId: z.number().int().positive().optional(),
  agentId: z.string().max(200).optional(),
  actionSequence: z.string().min(1).max(50000),
  inputContext: z.string().min(1).max(10000),
  outputResult: z.string().min(1).max(50000),
  durationMs: z.number().int().min(0),
  tokenCost: z.number().min(0).optional(),
  success: z.boolean(),
})

const refreshPatternSchema = z.object({
  action: z.literal('refresh_pattern'),
  patternId: z.number().int().positive(),
})

const applyFeedbackSchema = z.object({
  action: z.literal('apply_feedback'),
  feedbackId: z.number().int().positive(),
})

const decaySchema = z.object({
  action: z.literal('apply_decay'),
})

const postBodySchema = z.discriminatedUnion('action', [
  recordPatternSchema,
  recordFeedbackSchema,
  recordTraceSchema,
  refreshPatternSchema,
  applyFeedbackSchema,
  decaySchema,
])

// ---------------------------------------------------------------------------
// GET /api/learning
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const rateLimited = readLimiter(request)
  if (rateLimited) return rateLimited

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const workspaceId = auth.user.workspace_id
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  try {
    if (mode === 'suggest') {
      return handleSuggestRequest(searchParams, workspaceId)
    }

    if (mode === 'similar_traces') {
      return handleSimilarTracesRequest(searchParams, workspaceId)
    }

    if (mode === 'check_novel') {
      return handleNovelCheckRequest(searchParams, workspaceId)
    }

    return handleStatsRequest(workspaceId)
  } catch (error) {
    logger.error({ err: error }, 'Learning GET request failed')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// GET handlers
// ---------------------------------------------------------------------------

function handleStatsRequest(workspaceId: number): NextResponse {
  const stats = getLearningStats(workspaceId)
  const topPatterns = getTopPatterns(workspaceId, 10)
  const recentFeedback = getRecentFeedback(workspaceId, 10)

  return NextResponse.json({
    stats,
    topPatterns,
    recentFeedback,
  })
}

function handleSuggestRequest(
  params: URLSearchParams,
  workspaceId: number,
): NextResponse {
  const context = params.get('context')
  const patternType = params.get('patternType')

  if (!context || !patternType) {
    return NextResponse.json(
      { error: 'context and patternType query params are required' },
      { status: 400 },
    )
  }

  const suggestions = suggestPatterns(context, patternType, workspaceId)
  return NextResponse.json({ suggestions })
}

function handleSimilarTracesRequest(
  params: URLSearchParams,
  workspaceId: number,
): NextResponse {
  const context = params.get('context')
  if (!context) {
    return NextResponse.json(
      { error: 'context query param is required' },
      { status: 400 },
    )
  }

  const traces = findSimilarTraces(context, workspaceId)
  return NextResponse.json({ traces })
}

function handleNovelCheckRequest(
  params: URLSearchParams,
  workspaceId: number,
): NextResponse {
  const context = params.get('context')
  const patternType = params.get('patternType')

  if (!context || !patternType) {
    return NextResponse.json(
      { error: 'context and patternType query params are required' },
      { status: 400 },
    )
  }

  const novel = isNovelProblem(patternType, context, workspaceId)
  return NextResponse.json({ novel })
}

// ---------------------------------------------------------------------------
// POST /api/learning
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const rateLimited = mutationLimiter(request)
  if (rateLimited) return rateLimited

  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const validated = await validateBody(request, postBodySchema)
  if ('error' in validated) return validated.error

  const workspaceId = auth.user.workspace_id

  try {
    return dispatchPostAction(validated.data, workspaceId)
  } catch (error) {
    logger.error({ err: error }, 'Learning POST request failed')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST action dispatcher
// ---------------------------------------------------------------------------

type PostAction = z.infer<typeof postBodySchema>

function dispatchPostAction(
  data: PostAction,
  workspaceId: number,
): NextResponse {
  switch (data.action) {
    case 'record_pattern':
      return handleRecordPattern(data, workspaceId)
    case 'record_feedback':
      return handleRecordFeedback(data, workspaceId)
    case 'record_trace':
      return handleRecordTrace(data, workspaceId)
    case 'refresh_pattern':
      return handleRefreshPattern(data, workspaceId)
    case 'apply_feedback':
      return handleApplyFeedback(data, workspaceId)
    case 'apply_decay':
      return handleApplyDecay(workspaceId)
  }
}

// ---------------------------------------------------------------------------
// POST handlers
// ---------------------------------------------------------------------------

function handleRecordPattern(
  data: z.infer<typeof recordPatternSchema>,
  workspaceId: number,
): NextResponse {
  const recordFn = data.reinforce ? recordOrReinforcePattern : recordPattern

  const pattern = recordFn({
    patternType: data.patternType,
    triggerContext: data.triggerContext,
    actionTaken: data.actionTaken,
    outcome: data.outcome as PatternOutcome,
    workspaceId,
  })

  return NextResponse.json({ pattern }, { status: 201 })
}

function handleRecordFeedback(
  data: z.infer<typeof recordFeedbackSchema>,
  workspaceId: number,
): NextResponse {
  const entry = recordFeedback({
    taskId: data.taskId,
    patternId: data.patternId,
    rating: data.rating,
    correction: data.correction,
    workspaceId,
  })

  return NextResponse.json({ feedback: entry }, { status: 201 })
}

function handleRecordTrace(
  data: z.infer<typeof recordTraceSchema>,
  workspaceId: number,
): NextResponse {
  const trace = recordExecutionTrace({
    taskId: data.taskId,
    agentId: data.agentId,
    actionSequence: data.actionSequence,
    inputContext: data.inputContext,
    outputResult: data.outputResult,
    durationMs: data.durationMs,
    tokenCost: data.tokenCost,
    success: data.success,
    workspaceId,
  })

  return NextResponse.json({ trace }, { status: 201 })
}

function handleRefreshPattern(
  data: z.infer<typeof refreshPatternSchema>,
  workspaceId: number,
): NextResponse {
  const pattern = refreshPatternUsage(data.patternId, workspaceId)
  if (!pattern) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 })
  }
  return NextResponse.json({ pattern })
}

function handleApplyFeedback(
  data: z.infer<typeof applyFeedbackSchema>,
  workspaceId: number,
): NextResponse {
  const entry = markFeedbackApplied(data.feedbackId, workspaceId)
  if (!entry) {
    return NextResponse.json(
      { error: 'Feedback entry not found' },
      { status: 404 },
    )
  }
  return NextResponse.json({ feedback: entry })
}

function handleApplyDecay(workspaceId: number): NextResponse {
  const decayed = applyDecay(workspaceId)
  return NextResponse.json({ decayed })
}

export const dynamic = 'force-dynamic'
