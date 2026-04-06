import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { CouncilDeliberationEngine } from '@/lib/council'

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const StartSchema = z.object({
  action: z.literal('start'),
  topic: z.string().min(1).max(500),
  context: z.record(z.string(), z.unknown()).optional().default({}),
  workspaceId: z.number().int().positive().optional().default(1),
})

const VoteSchema = z.object({
  action: z.literal('vote'),
  deliberationId: z.number().int().positive(),
  agentId: z.string().min(1),
  position: z.string().min(1).max(1000),
  stance: z.enum(['support', 'oppose', 'neutral', 'abstain']),
  confidence: z.number().min(0).max(1),
  workspaceId: z.number().int().positive().optional().default(1),
})

const AdvanceSchema = z.object({
  action: z.literal('advance'),
  deliberationId: z.number().int().positive(),
})

const SynthesizeSchema = z.object({
  action: z.literal('synthesize'),
  deliberationId: z.number().int().positive(),
})

const ActionSchema = z.discriminatedUnion('action', [
  StartSchema,
  VoteSchema,
  AdvanceSchema,
  SynthesizeSchema,
])

type ParsedAction = z.infer<typeof ActionSchema>

// ---------------------------------------------------------------------------
// GET /api/council
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimited = readLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(req.url)
  const workspaceId = auth.user.workspace_id
  const engine = CouncilDeliberationEngine.getInstance()

  try {
    const id = searchParams.get('id')

    if (id) {
      const delib = engine.getDeliberation(Number(id), workspaceId)
      if (!delib) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ data: delib })
    }

    const deliberations = engine.listDeliberations(workspaceId)
    return NextResponse.json({ data: deliberations })
  } catch (err) {
    logger.error({ err }, 'Council GET request failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/council
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
    return await dispatchAction(validated.data, auth.user.workspace_id)
  } catch (err) {
    logger.error({ err }, 'Council POST request failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Action dispatcher
// ---------------------------------------------------------------------------

async function dispatchAction(data: ParsedAction, workspaceId: number): Promise<NextResponse> {
  const engine = CouncilDeliberationEngine.getInstance()

  if (data.action === 'start') {
    const id = await engine.startDeliberation(data.topic, data.context, workspaceId)
    return NextResponse.json({ data: { deliberationId: id } }, { status: 201 })
  }

  if (data.action === 'vote') {
    const delib = engine.getDeliberation(data.deliberationId, workspaceId)
    if (!delib) return NextResponse.json({ error: 'Deliberation not found' }, { status: 404 })
    await engine.submitVote({ ...data, round: delib.round, workspaceId })
    return NextResponse.json({ data: { ok: true } })
  }

  if (data.action === 'advance') {
    // WHY: Verify workspace ownership before mutation — deliberationId comes from
    // the request body and must belong to the authenticated user's workspace.
    const owned = engine.getDeliberation(data.deliberationId, workspaceId)
    if (!owned) return NextResponse.json({ error: 'Deliberation not found' }, { status: 404 })
    const result = await engine.advanceRound(data.deliberationId)
    return NextResponse.json({ data: { result } })
  }

  // action === 'synthesize'
  // Same ownership check — synthesize also mutates, must be within caller's workspace.
  const owned = engine.getDeliberation(data.deliberationId, workspaceId)
  if (!owned) return NextResponse.json({ error: 'Deliberation not found' }, { status: 404 })
  const synthesis = await engine.synthesize(data.deliberationId, workspaceId)
  return NextResponse.json({ data: { synthesis } })
}

export const dynamic = 'force-dynamic'
