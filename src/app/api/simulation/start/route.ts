import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { getSimulationEngine, isSimulationEnabled } from '@/lib/simulation-engine'

const schema = z.object({
  tickIntervalMs: z.number().int().min(1000).max(60000).optional(),
  dryRun: z.boolean().optional(),
  operationTimeoutMs: z.number().int().min(5000).max(300000).optional(),
}).optional()

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!isSimulationEnabled()) {
    return NextResponse.json(
      { error: 'Simulation is disabled. Set SIMULATION_ENABLED=true to enable.' },
      { status: 503 },
    )
  }

  let config: Record<string, unknown> | undefined
  try {
    const body = await request.json().catch(() => ({}))
    if (body && typeof body === 'object') config = body
  } catch {
    // No body is fine — use defaults
  }

  try {
    const engine = getSimulationEngine(config)
    engine.start()
    return NextResponse.json({ status: 'started', config: engine.getStatus().config })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start simulation'
    logger.error({ err }, 'POST /api/simulation/start error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
