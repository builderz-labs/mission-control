import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { startWorkflow, runWorkflow, getTemplateNames } from '@/lib/sop-engine'

const schema = z.object({
  templateName: z.string().min(1),
  userInput: z.string().min(1).max(5000),
  agentId: z.number().int().positive(),
  maxRounds: z.number().int().min(1).max(100).optional(),
  async: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, schema)
  if ('error' in result) return result.error

  const body = result.data
  const workspaceId = auth.user.workspace_id ?? 1

  // Validate template name
  if (!getTemplateNames().includes(body.templateName)) {
    return NextResponse.json(
      { error: `Unknown template. Available: ${getTemplateNames().join(', ')}` },
      { status: 400 },
    )
  }

  try {
    if (body.async) {
      // Start workflow and return immediately (run continues in background)
      const run = startWorkflow(body.templateName, body.userInput, body.agentId, workspaceId, body.maxRounds)
      // Fire and forget the execution
      runWorkflow(body.templateName, body.userInput, body.agentId, workspaceId, body.maxRounds).catch((err) => {
        logger.error({ err, runId: run.id }, 'Async SOP workflow failed')
      })
      return NextResponse.json({ runId: run.id, status: 'running' }, { status: 202 })
    }

    // Synchronous: run until completion
    const run = await runWorkflow(body.templateName, body.userInput, body.agentId, workspaceId, body.maxRounds)
    return NextResponse.json({
      runId: run.id,
      status: run.status,
      rounds: run.currentRound,
    }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start workflow'
    logger.error({ err, templateName: body.templateName }, 'POST /api/workflows/sop/start error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
