import { writeFile } from 'fs/promises'
import { dirname } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { ensureDirExists } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { calculateTokenCost } from '@/lib/token-pricing'
import { getProviderSubscriptionFlags } from '@/lib/provider-subscriptions'
import {
  DATA_PATH,
  extractAgentName,
  loadTokenDataFromFile,
  type TokenUsageRecord,
} from './get-handler'

async function saveTokenData(data: TokenUsageRecord[]): Promise<void> {
  ensureDirExists(dirname(DATA_PATH))
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2))
}

/**
 * POST /api/tokens — Record a new token usage entry.
 * Persists manually posted usage records in the JSON file and returns the saved record.
 */
export async function handlePostTokens(request: NextRequest): Promise<NextResponse> {
  const limited = mutationLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const workspaceId = auth.user.workspace_id ?? 1
    const { model, sessionId, inputTokens, outputTokens, operation = 'chat_completion', duration, taskId } = body

    if (!model || !sessionId || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const totalTokens = inputTokens + outputTokens
    const providerSubscriptions = getProviderSubscriptionFlags()
    const cost = calculateTokenCost(model, inputTokens, outputTokens, { providerSubscriptions })

    const parsedTaskId =
      taskId != null && Number.isFinite(Number(taskId)) && Number(taskId) > 0
        ? Number(taskId)
        : null

    // Validate taskId against the database to prevent phantom references
    let validatedTaskId: number | null = null
    if (parsedTaskId) {
      const db = getDatabase()
      const taskRow = db
        .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
        .get(parsedTaskId, workspaceId) as { id?: number } | undefined
      if (taskRow?.id) validatedTaskId = taskRow.id
    }

    const record: TokenUsageRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      model,
      sessionId,
      agentName: extractAgentName(sessionId),
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation,
      taskId: validatedTaskId,
      workspaceId,
      duration,
    }

    const existingData = await loadTokenDataFromFile(workspaceId, providerSubscriptions)
    const trimmed = existingData.length >= 10000 ? existingData.slice(0, 9999) : existingData

    await saveTokenData([record, ...trimmed])

    return NextResponse.json({ success: true, record })
  } catch (error) {
    logger.error({ err: error }, 'Error saving token usage')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
