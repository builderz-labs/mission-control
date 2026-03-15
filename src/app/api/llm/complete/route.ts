import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { heavyLimiter } from '@/lib/rate-limit'
import { complete } from '@/lib/llm/router'
import type { TaskTier, ChatMessage } from '@/lib/llm/inference-adapter'

const completionSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1),
  })).min(1, 'At least one message is required'),
  model: z.string().optional(),
  tier: z.enum(['fast', 'standard', 'complex']).optional(),
  taskType: z.string().optional(),
  agentId: z.number().int().positive(),
  taskId: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, completionSchema)
  if ('error' in result) return result.error

  const body = result.data
  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const messages: ChatMessage[] = body.messages
    const response = await complete(messages, {
      agentId: body.agentId,
      workspaceId,
      taskType: body.taskType,
      tier: body.tier as TaskTier | undefined,
      model: body.model,
      taskId: body.taskId,
    })

    return NextResponse.json({
      text: response.text,
      model: response.model,
      tokenCount: response.tokenCount,
      cost: response.cost,
      latencyMs: response.latencyMs,
      stopReason: response.stopReason,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LLM completion failed'

    // Budget/rate errors are 429
    if (message.includes('exceeded')) {
      return NextResponse.json({ error: message }, { status: 429 })
    }

    // Feature disabled
    if (message.includes('disabled')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }

    logger.error({ err, agentId: body.agentId }, 'POST /api/llm/complete error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
