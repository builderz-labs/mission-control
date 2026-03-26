/**
 * Transaction cost calculations for trading agent deployment assessment.
 * Mirrors the fee schedules defined in moon-dev-ai-agents/src/models/transaction_cost_model.py
 */

export type FeeSchedule = {
  maker: number
  taker: number
}

export const DEFAULT_FEE_SCHEDULES: Record<string, FeeSchedule> = {
  hyperliquid: { maker: 0.0002, taker: 0.0005 },
  coinbase: { maker: 0.004, taker: 0.006 },
  interactive_brokers: { maker: 0.0002, taker: 0.0003 },
}

/**
 * Calculate entry and exit fees for a position using taker rates (worst-case assumption).
 */
export function calculateFees(
  exchange: string,
  positionSize: number
): { entry: number; exit: number } {
  const schedule = DEFAULT_FEE_SCHEDULES[exchange.toLowerCase()]
  if (!schedule) {
    // Unknown exchange: use a conservative default (0.1% taker)
    const fee = positionSize * 0.001
    return { entry: fee, exit: fee }
  }
  return {
    entry: positionSize * schedule.taker,
    exit: positionSize * schedule.taker,
  }
}

/**
 * Estimate market impact / slippage cost.
 * @param positionSize - Position size in USD
 * @param slippageBps  - Slippage in basis points (default: 10 bps = 0.1%)
 */
export function estimateSlippage(positionSize: number, slippageBps: number = 10): number {
  return positionSize * (slippageBps / 10000)
}

/**
 * Estimate funding cost for a leveraged position held for N hours.
 * @param positionSize - Position size in USD
 * @param hours        - Holding period in hours
 * @param hourlyRate   - Hourly funding rate as a decimal (default: 0.0001 = 0.01%)
 */
export function estimateFunding(
  positionSize: number,
  hours: number,
  hourlyRate: number = 0.0001
): number {
  return positionSize * hourlyRate * hours
}

export type DeploymentAssessmentParams = {
  agent_name: string
  strategy: string
  exchange: string
  symbol: string
  position_size_usd: number
  expected_return_pct: number
  holding_period_hours?: number
}

export type RiskChecks = {
  within_position_limit: boolean
  within_exposure_limit: boolean
  kill_switch_ok: boolean
}

export type CostBreakdown = {
  entry_fee: number
  exit_fee: number
  slippage: number
  funding: number
  total_cost: number
  total_cost_pct: number
}

export type DeploymentAssessment = {
  verdict: 'profitable' | 'marginal' | 'losing'
  strategy_info: {
    agent_name: string
    strategy: string
    exchange: string
    symbol: string
    position_size_usd: number
  }
  cost_breakdown: CostBreakdown
  expected_return_usd: number
  net_return_usd: number
  net_return_pct: number
  risk_checks: RiskChecks
}

const MAX_POSITION_USD = 100
const MAX_TOTAL_EXPOSURE_USD = 500
const KILL_SWITCH_DRAWDOWN_PCT = 15

/**
 * Full deployment assessment combining fees, slippage, funding, and risk checks.
 */
export function assessDeployment(params: DeploymentAssessmentParams): DeploymentAssessment {
  const {
    agent_name,
    strategy,
    exchange,
    symbol,
    position_size_usd,
    expected_return_pct,
    holding_period_hours = 0,
  } = params

  const { entry, exit } = calculateFees(exchange, position_size_usd)
  const slippage = estimateSlippage(position_size_usd)
  const funding = estimateFunding(position_size_usd, holding_period_hours)

  const total_cost = entry + exit + slippage + funding
  const total_cost_pct = position_size_usd > 0 ? (total_cost / position_size_usd) * 100 : 0

  const expected_return_usd = position_size_usd * (expected_return_pct / 100)
  const net_return_usd = expected_return_usd - total_cost
  const net_return_pct = position_size_usd > 0 ? (net_return_usd / position_size_usd) * 100 : 0

  const risk_checks: RiskChecks = {
    within_position_limit: position_size_usd <= MAX_POSITION_USD,
    within_exposure_limit: position_size_usd <= MAX_TOTAL_EXPOSURE_USD,
    kill_switch_ok: Math.abs(net_return_pct) < KILL_SWITCH_DRAWDOWN_PCT || net_return_pct > 0,
  }

  let verdict: 'profitable' | 'marginal' | 'losing'
  if (net_return_pct > 1.0) {
    verdict = 'profitable'
  } else if (net_return_pct > 0) {
    verdict = 'marginal'
  } else {
    verdict = 'losing'
  }

  return {
    verdict,
    strategy_info: {
      agent_name,
      strategy,
      exchange,
      symbol,
      position_size_usd,
    },
    cost_breakdown: {
      entry_fee: entry,
      exit_fee: exit,
      slippage,
      funding,
      total_cost,
      total_cost_pct,
    },
    expected_return_usd,
    net_return_usd,
    net_return_pct,
    risk_checks,
  }
}
