import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { heavyLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, spawnAgentSchema } from '@/lib/validation'
import { scanForInjection } from '@/lib/injection-guard'
import { logAuditEvent } from '@/lib/db'
import { enforceExecutionGate } from '@/lib/enforcement/execution-gate-enforcer'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getDefaultProvider } from '@/lib/execution/providers/registry'
import { logExecutionEvent } from '@/lib/execution/execution-logger'

function getPreferredToolsProfile(): string {
  return String(process.env.OPENCLAW_TOOLS_PROFILE || 'coding').trim() || 'coding'
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  // Execution gate: enforce for agent-initiated spawns.
  // Human operators (no agent_name) are covered by requireRole above.
  if (auth.user.agent_name) {
    const gate = enforceExecutionGate({ agentId: auth.user.agent_name })
    if (!gate.allowed) return gate.response
  }

  try {
    const result = await validateBody(request, spawnAgentSchema)
    if ('error' in result) return result.error
    const { task, model, label, timeoutSeconds } = result.data

    // Scan the task prompt and label for injection before sending to an agent
    const fieldsToScan = [
      { name: 'task', value: task },
      ...(label ? [{ name: 'label', value: label }] : []),
    ]
    for (const field of fieldsToScan) {
      const injectionReport = scanForInjection(field.value, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ field: field.name, rules: criticals.map(m => m.rule) }, `Blocked spawn: injection detected in ${field.name}`)
          return NextResponse.json(
            { error: `${field.name} blocked: potentially unsafe content detected`, injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
            { status: 422 }
          )
        }
      }
    }

    const timeout = timeoutSeconds

    // Generate spawn ID
    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Construct the spawn command
    // Using OpenClaw's sessions_spawn function via clawdbot CLI
    const spawnPayload = {
      task,
      label,
      ...(model ? { model } : {}),
      runTimeoutSeconds: timeout,
      tools: {
        profile: getPreferredToolsProfile(),
      },
    }

    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) {
      return wsResult.response
    }

    const spawnStartedAt = Date.now()
    const workspaceId = wsResult.workspaceId

    logExecutionEvent({
      event_type: 'spawn_started',
      provider_id: getDefaultProvider().id,
      workspace_id: workspaceId,
      detail: { spawnId, model: model ?? null, label, toolsProfile: getPreferredToolsProfile() },
    })

    const provider = getDefaultProvider()
    const spawnResult = await provider.spawn(spawnPayload)
    const duration_ms = Date.now() - spawnStartedAt

    if (!spawnResult.ok) {
      logger.error({ err: spawnResult.error }, 'Spawn execution error')
      logExecutionEvent({
        event_type: 'spawn_failed',
        provider_id: provider.id,
        workspace_id: workspaceId,
        duration_ms,
        success: false,
        error_code: spawnResult.error.code,
        detail: { spawnId, message: spawnResult.error.message },
      })
      return NextResponse.json({
        success: false,
        spawnId,
        error: spawnResult.error.message,
        task,
        model: model ?? null,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now(),
      }, { status: 500 })
    }

    try {
      const result = spawnResult.data as Record<string, unknown>
      const compatibilityFallbackUsed = Boolean(spawnResult.meta?.fallbackUsed)
      const sessionInfo = (result?.sessionId as string | undefined) || (result?.session_id as string | undefined) || null

      logExecutionEvent({
        event_type: 'spawn_completed',
        provider_id: provider.id,
        workspace_id: workspaceId,
        session_key: sessionInfo ?? undefined,
        duration_ms,
        success: true,
        detail: { spawnId, compatibilityFallbackUsed },
      })

      const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      logAuditEvent({
        action: 'agent_spawn',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: {
          spawnId,
          model: model ?? null,
          label,
          task_summary: task.length > 120 ? task.slice(0, 120) + '...' : task,
          toolsProfile: getPreferredToolsProfile(),
          compatibilityFallbackUsed,
        },
        ip_address: ipAddress,
      })

      return NextResponse.json({
        success: true,
        spawnId,
        sessionInfo,
        task,
        model: model ?? null,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now(),
        result,
        compatibility: {
          toolsProfile: getPreferredToolsProfile(),
          fallbackUsed: compatibilityFallbackUsed,
        },
      })

    } catch (execError: any) {
      logger.error({ err: execError }, 'Spawn post-processing error')

      return NextResponse.json({
        success: false,
        spawnId,
        error: execError.message || 'Failed to spawn agent',
        task,
        model: model ?? null,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now()
      }, { status: 500 })
    }

  } catch (error) {
    logger.error({ err: error }, 'Spawn API error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Get spawn history
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    // Read recent spawn activity from logs when a dedicated history store is unavailable.
    
    try {
      if (!config.logsDir) {
        return NextResponse.json({ history: [] })
      }

      const files = await readdir(config.logsDir)
      const logFiles = await Promise.all(
        files
          .filter((file) => file.endsWith('.log'))
          .map(async (file) => {
            const fullPath = join(config.logsDir, file)
            const stats = await stat(fullPath)
            return { file, fullPath, mtime: stats.mtime.getTime() }
          })
      )

      const recentLogs = logFiles
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5)

      const lines: string[] = []

      for (const log of recentLogs) {
        const content = await readFile(log.fullPath, 'utf-8')
        const matched = content
          .split('\n')
          .filter((line) => line.includes('sessions_spawn'))
        lines.push(...matched)
      }

      const spawnHistory = lines
        .slice(-limit)
        .map((line, index) => {
          try {
            const timestampMatch = line.match(
              /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
            )
            const modelMatch = line.match(/model[:\s]+"([^"]+)"/)
            const taskMatch = line.match(/task[:\s]+"([^"]+)"/)

            return {
              id: `history-${Date.now()}-${index}`,
              timestamp: timestampMatch
                ? new Date(timestampMatch[1]).getTime()
                : Date.now(),
              model: modelMatch ? modelMatch[1] : 'unknown',
              task: taskMatch ? taskMatch[1] : 'unknown',
              status: 'completed',
              line: line.trim()
            }
          } catch (parseError) {
            return null
          }
        })
        .filter(Boolean)

      return NextResponse.json({ history: spawnHistory })

    } catch (logError) {
      // If we can't read logs, return empty history
      return NextResponse.json({ history: [] })
    }

  } catch (error) {
    logger.error({ err: error }, 'Spawn history API error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
