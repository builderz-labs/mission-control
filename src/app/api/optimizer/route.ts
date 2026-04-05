import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { HillClimbingOptimizer } from '@/lib/hill-climbing'
import { bridgeComparisonToPattern } from '@/lib/hill-climbing-feedback-bridge'
import type { ComparisonResult } from '@/lib/hill-climbing'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  action: z.literal('create'),
  operationName: z.string().min(1).max(200),
  configA: z.record(z.string(), z.unknown()),
  configB: z.record(z.string(), z.unknown()).optional(),
  metricName: z.string().min(1).max(200),
  mutationOptions: z.object({
    mutationRate: z.number().min(0).max(1).optional(),
    fields: z.array(z.string()).optional(),
  }).optional(),
})

const outcomeSchema = z.object({
  action: z.literal('outcome'),
  comparisonId: z.number().int().positive(),
  variant: z.enum(['a', 'b']),
  value: z.number(),
})

const evalSchema = z.object({
  action: z.literal('evaluate'),
  comparisonId: z.number().int().positive(),
  bridgeToPatterns: z.boolean().optional().default(true),
})

const postBodySchema = z.discriminatedUnion('action', [
  createSchema,
  outcomeSchema,
  evalSchema,
])

// ---------------------------------------------------------------------------
// GET /api/optimizer — list comparisons for an operation
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimited = readLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(req.url)
  const operationName = searchParams.get('operation') ?? ''
  const workspaceId = auth.user.workspace_id
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 100)

  try {
    const optimizer = HillClimbingOptimizer.getInstance()
    const comparisons = optimizer.listComparisons(operationName, workspaceId, limit)
    return NextResponse.json({ data: comparisons })
  } catch (err) {
    logger.error({ err }, 'Optimizer GET failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/optimizer — create | record outcome | evaluate
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rateLimited = mutationLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const validated = await validateBody(req, postBodySchema)
  if ('error' in validated) return validated.error

  const workspaceId = auth.user.workspace_id

  try {
    return dispatchAction(validated.data, workspaceId)
  } catch (err) {
    logger.error({ err }, 'Optimizer POST failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Action dispatcher
// ---------------------------------------------------------------------------

type PostAction = z.infer<typeof postBodySchema>

function dispatchAction(data: PostAction, workspaceId: number): NextResponse {
  const optimizer = HillClimbingOptimizer.getInstance()

  if (data.action === 'create') {
    return handleCreate(optimizer, data, workspaceId)
  }
  if (data.action === 'outcome') {
    return handleOutcome(optimizer, data)
  }
  if (data.action === 'evaluate') {
    return handleEvaluate(optimizer, data, workspaceId)
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleCreate(
  optimizer: HillClimbingOptimizer,
  data: z.infer<typeof createSchema>,
  workspaceId: number,
): NextResponse {
  const configB = data.configB ?? optimizer.proposeVariant(data.configA, data.mutationOptions)
  const id = optimizer.createComparison(data.operationName, data.configA, configB, data.metricName, workspaceId)
  return NextResponse.json({ data: { comparisonId: id, configB } }, { status: 201 })
}

function handleOutcome(
  optimizer: HillClimbingOptimizer,
  data: z.infer<typeof outcomeSchema>,
): NextResponse {
  optimizer.recordOutcome({ comparisonId: data.comparisonId, variant: data.variant, metricName: '', value: data.value })
  return NextResponse.json({ data: { ok: true } })
}

function handleEvaluate(
  optimizer: HillClimbingOptimizer,
  data: z.infer<typeof evalSchema>,
  workspaceId: number,
): NextResponse {
  const result: ComparisonResult = optimizer.evaluateComparison(data.comparisonId)
  if (data.bridgeToPatterns) {
    bridgeComparisonToPattern(data.comparisonId, result, workspaceId)
  }
  return NextResponse.json({ data: result })
}

export const dynamic = 'force-dynamic'
