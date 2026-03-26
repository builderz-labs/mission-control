import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assessDeployment, DEFAULT_FEE_SCHEDULES } from '@/lib/transaction-costs'

/**
 * POST /api/deploy/assess
 *
 * Evaluates whether a trading agent deployment is profitable after transaction costs.
 *
 * Body:
 *   agent_name            - Name of the trading agent
 *   strategy              - Strategy identifier (e.g. "momentum", "mean_reversion")
 *   exchange              - Exchange identifier (hyperliquid | coinbase | interactive_brokers)
 *   symbol                - Trading symbol (e.g. "BTC-USD")
 *   position_size_usd     - Position size in USD
 *   expected_return_pct   - Expected gross return as a percentage (e.g. 2.5 for 2.5%)
 *   holding_period_hours  - (optional) Holding period in hours for funding cost estimation
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const {
    agent_name,
    strategy,
    exchange,
    symbol,
    position_size_usd,
    expected_return_pct,
    holding_period_hours,
  } = body as Record<string, unknown>

  // --- Input validation ---
  const errors: string[] = []

  if (typeof agent_name !== 'string' || agent_name.trim() === '') {
    errors.push('agent_name must be a non-empty string')
  }
  if (typeof strategy !== 'string' || strategy.trim() === '') {
    errors.push('strategy must be a non-empty string')
  }
  if (typeof exchange !== 'string' || exchange.trim() === '') {
    errors.push('exchange must be a non-empty string')
  } else if (!DEFAULT_FEE_SCHEDULES[exchange.toLowerCase()]) {
    const valid = Object.keys(DEFAULT_FEE_SCHEDULES).join(', ')
    errors.push(`exchange must be one of: ${valid}`)
  }
  if (typeof symbol !== 'string' || symbol.trim() === '') {
    errors.push('symbol must be a non-empty string')
  }
  if (typeof position_size_usd !== 'number' || position_size_usd <= 0) {
    errors.push('position_size_usd must be a positive number')
  }
  if (typeof expected_return_pct !== 'number') {
    errors.push('expected_return_pct must be a number')
  }
  if (
    holding_period_hours !== undefined &&
    (typeof holding_period_hours !== 'number' || holding_period_hours < 0)
  ) {
    errors.push('holding_period_hours must be a non-negative number')
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const assessment = assessDeployment({
    agent_name: (agent_name as string).trim(),
    strategy: (strategy as string).trim(),
    exchange: (exchange as string).trim(),
    symbol: (symbol as string).trim(),
    position_size_usd: position_size_usd as number,
    expected_return_pct: expected_return_pct as number,
    holding_period_hours:
      typeof holding_period_hours === 'number' ? holding_period_hours : undefined,
  })

  return NextResponse.json(assessment)
}
