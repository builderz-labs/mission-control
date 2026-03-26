import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

interface TransactionCostEntry {
  maker_fee: number
  taker_fee: number
  slippage_bps: number
  funding_rate_per_8h?: number
}

interface TradingConfig {
  default_exchange: string
  symbols: string[]
  trade_mode: 'paper' | 'live'
  max_position_usd: number
  max_total_exposure_usd: number
  min_balance_usd: number
  max_drawdown_pct: number
  default_leverage: number
  kill_switch_drawdown_pct: number
  swarm_enabled: boolean
  require_swarm_confidence_pct: number
  swarm_vote_timeout_sec: number
  require_risk_approval: boolean
  sleep_between_checks_sec: number
  balance_history_max_entries: number
  cash_percentage: number
  data_timeframe: string
  daysback_for_data: number
  transaction_costs: Record<string, TransactionCostEntry>
}

function getConfigPath(): string {
  return path.resolve(process.cwd(), '..', 'agent-zero', 'agents', 'trader', 'trading_config.json')
}

/**
 * Deep merge two objects. Arrays are replaced (not concatenated).
 * Non-object values in `updates` always overwrite `base`.
 */
function deepMerge(base: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const key of Object.keys(updates)) {
    const baseVal = base[key]
    const updateVal = updates[key]

    if (
      updateVal !== null &&
      typeof updateVal === 'object' &&
      !Array.isArray(updateVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        updateVal as Record<string, unknown>,
      )
    } else {
      result[key] = updateVal
    }
  }

  return result
}

/**
 * GET /api/config/trading
 * Returns the current trading configuration.
 */
export async function GET(_request: NextRequest) {
  const configPath = getConfigPath()

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as TradingConfig
    return NextResponse.json({ config })
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'Trading config file not found', path: configPath },
        { status: 404 },
      )
    }
    const message = nodeErr instanceof Error ? nodeErr.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to read trading config: ${message}` },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/config/trading
 * Deep-merges the request body into the existing config and writes it back.
 * Arrays in the request body replace their counterparts (not appended).
 */
export async function PUT(request: NextRequest) {
  const configPath = getConfigPath()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 },
    )
  }

  let existing: TradingConfig
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    existing = JSON.parse(raw) as TradingConfig
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'Trading config file not found', path: configPath },
        { status: 404 },
      )
    }
    const message = nodeErr instanceof Error ? nodeErr.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to read trading config: ${message}` },
      { status: 500 },
    )
  }

  const merged = deepMerge(
    existing as unknown as Record<string, unknown>,
    body as Record<string, unknown>,
  ) as unknown as TradingConfig

  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to write trading config: ${message}` },
      { status: 500 },
    )
  }

  const updated_at = Date.now()
  return NextResponse.json({ config: merged, updated_at })
}
