import { NextRequest, NextResponse } from 'next/server'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { heavyLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, spawnAgentSchema } from '@/lib/validation'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, spawnAgentSchema)
    if ('error' in result) return result.error
    const { task, model, label, timeoutSeconds } = result.data

    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const sessionId = label || `mc-spawn-${Date.now()}`
    const idempotencyKey = spawnId

    logger.info({ spawnId, sessionId, model }, 'Spawning agent via gateway call')

    const message = model ? `[model:${model}] ${task}` : task
    const params = JSON.stringify({ message, sessionId, idempotencyKey })

    const token = process.env.OPENCLAW_GATEWAY_TOKEN || ''

    // openclaw gateway call agent --token <t> --params <json> --json --timeout <ms>
    const args = [
      'gateway', 'call', 'agent',
      '--token', token,
      '--params', params,
      '--json',
      '--timeout', String(((timeoutSeconds ?? 60) + 10) * 1000)
    ]

    try {
      const { stdout, stderr } = await runOpenClaw(args, {
        timeoutMs: ((timeoutSeconds ?? 60) + 15) * 1000,
      })

      let res: Record<string, unknown> = {}
      try { res = JSON.parse(stdout) } catch { /* non-json output */ }

      return NextResponse.json({
        success: true,
        spawnId,
        sessionInfo: (res?.runId as string) || sessionId,
        runId: res?.runId,
        status: res?.status,
        task, model, label, sessionId,
        timeoutSeconds,
        createdAt: Date.now(),
        stdout: stdout.trim(),
      })
    } catch (execError: any) {
      logger.error({ err: execError }, 'Gateway spawn failed')
      return NextResponse.json({
        success: false,
        spawnId,
        error: execError.message || 'Failed to spawn agent',
        task, model, label, timeoutSeconds,
        createdAt: Date.now()
      }, { status: 500 })
    }
  } catch (error: any) {
    logger.error({ err: error }, 'Spawn API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({ history: [] })
}
