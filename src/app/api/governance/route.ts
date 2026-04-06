import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { GovernanceGateEngine } from '@/lib/governance'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const DimensionScoreSchema = z.object({
  dimension: z.enum(['correctness', 'completeness', 'style', 'security', 'performance']),
  score: z.number().min(0).max(1),
  notes: z.string().optional(),
})

const EvaluateSchema = z.object({
  action: z.literal('evaluate'),
  taskId: z.number().int().positive().nullable().optional().default(null),
  gateType: z.enum(['pre_deploy', 'pre_commit', 'pre_merge', 'pre_release']),
  scores: z.array(DimensionScoreSchema).min(1),
  // workspaceId is sourced exclusively from the verified auth token — never from the request body
  overrideBy: z.string().optional(),
})

const UpsertRuleSchema = z.object({
  action: z.literal('upsert_rule'),
  gateType: z.enum(['pre_deploy', 'pre_commit', 'pre_merge', 'pre_release']),
  dimension: z.enum(['correctness', 'completeness', 'style', 'security', 'performance']),
  weight: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  // workspaceId is sourced exclusively from the verified auth token — never from the request body
})

const ActionSchema = z.discriminatedUnion('action', [EvaluateSchema, UpsertRuleSchema])

// ---------------------------------------------------------------------------
// GET /api/governance
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimited = readLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(req.url)
  // WHY: workspaceId MUST come from the verified auth token, never from a query param.
  // Accepting it from the URL would allow any authenticated user to read another tenant's data.
  const workspaceId = auth.user.workspace_id

  try {
    const engine = GovernanceGateEngine.getInstance()
    const taskIdParam = searchParams.get('taskId')
    const gateType = searchParams.get('gateType')

    if (taskIdParam && gateType) {
      const outcome = engine.checkGate(Number(taskIdParam), gateType, workspaceId)
      return NextResponse.json({ data: { outcome } })
    }

    const results = engine.listResults(workspaceId)
    return NextResponse.json({ data: results })
  } catch (err) {
    logger.error({ err }, 'Governance GET request failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/governance
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rateLimited = mutationLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const validated = await validateBody(req, ActionSchema)
  if ('error' in validated) return validated.error

  try {
    const engine = GovernanceGateEngine.getInstance()
    const data = validated.data

    // WHY: workspaceId comes from auth, not from request body, to prevent cross-tenant writes.
    const workspaceId = auth.user.workspace_id

    if (data.action === 'evaluate') {
      const result = engine.evaluate({
        taskId: data.taskId ?? null,
        gateType: data.gateType,
        scores: data.scores,
        workspaceId,
        overrideBy: data.overrideBy,
      })
      return NextResponse.json({ data: result }, { status: result.passed ? 200 : 422 })
    }

    // action === 'upsert_rule'
    engine.upsertRule({
      gateType: data.gateType,
      dimension: data.dimension,
      weight: data.weight,
      threshold: data.threshold,
      workspaceId,
    })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    logger.error({ err }, 'Governance POST request failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
