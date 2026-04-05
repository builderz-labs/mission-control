import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DailySpend {
  date: string   // ISO date YYYY-MM-DD
  cost: number   // USD
  tokens: number
}

export interface ForecastPoint {
  date: string
  predicted: number
  lower: number   // 80% CI lower bound
  upper: number   // 80% CI upper bound
}

export interface CostForecast {
  historical: DailySpend[]
  forecast: ForecastPoint[]   // next 14 days
  slope: number               // $/day trend
  r2: number                  // goodness of fit 0-1
  projectedMonthTotal: number // 30-day projection
  currentMonthTotal: number   // current MTD
  budgetAlert: boolean        // true if projected > budget threshold
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CostTrackingRow {
  date: string
  daily_cost: number
  daily_tokens: number
}

interface TokenUsageRow {
  date: string
  daily_cost: number
  daily_tokens: number
}

// ---------------------------------------------------------------------------
// Data fetching — prefers cost_tracking, falls back to token_usage
// ---------------------------------------------------------------------------

function fetchDailySpend(workspaceId: number, db: Database.Database): DailySpend[] {
  const rows = db.prepare(`
    SELECT date(datetime(created_at, 'unixepoch')) AS date,
           SUM(cost_usd) AS daily_cost,
           SUM(token_input + token_output) AS daily_tokens
    FROM cost_tracking
    WHERE workspace_id = ?
      AND created_at >= unixepoch('now', '-30 days')
    GROUP BY date
    ORDER BY date ASC
  `).all(workspaceId) as CostTrackingRow[]

  if (rows.length > 0) {
    return rows.map(r => ({ date: r.date, cost: r.daily_cost, tokens: r.daily_tokens }))
  }

  // Fallback: token_usage table
  const fallback = db.prepare(`
    SELECT date(datetime(created_at, 'unixepoch')) AS date,
           SUM(input_tokens * 3.0 / 1000000 + output_tokens * 15.0 / 1000000) AS daily_cost,
           SUM(input_tokens + output_tokens) AS daily_tokens
    FROM token_usage
    WHERE workspace_id = ?
      AND created_at >= unixepoch('now', '-30 days')
    GROUP BY date
    ORDER BY date ASC
  `).all(workspaceId) as TokenUsageRow[]

  return fallback.map(r => ({ date: r.date, cost: r.daily_cost, tokens: r.daily_tokens }))
}

// ---------------------------------------------------------------------------
// Linear regression helpers (each under 50 lines)
// ---------------------------------------------------------------------------

interface RegressionParams {
  slope: number
  intercept: number
  r2: number
  residualStd: number
}

function computeSums(ys: number[]): { sumX: number; sumY: number; sumXY: number; sumX2: number } {
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < ys.length; i++) {
    sumX += i
    sumY += ys[i]
    sumXY += i * ys[i]
    sumX2 += i * i
  }
  return { sumX, sumY, sumXY, sumX2 }
}

function computeR2(ys: number[], slope: number, intercept: number): number {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length
  const ssTot = ys.reduce((acc, y) => acc + (y - mean) ** 2, 0)
  const ssRes = ys.reduce((acc, y, i) => acc + (y - (slope * i + intercept)) ** 2, 0)
  return ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
}

function computeResidualStd(ys: number[], slope: number, intercept: number): number {
  if (ys.length < 2) return 0
  const residuals = ys.map((y, i) => y - (slope * i + intercept))
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length
  const variance = residuals.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (residuals.length - 1)
  return Math.sqrt(variance)
}

function linearRegression(ys: number[]): RegressionParams {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, residualStd: 0 }

  const { sumX, sumY, sumXY, sumX2 } = computeSums(ys)
  const denom = n * sumX2 - sumX * sumX
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const r2 = computeR2(ys, slope, intercept)
  const residualStd = computeResidualStd(ys, slope, intercept)

  return { slope, intercept, r2, residualStd }
}

// ---------------------------------------------------------------------------
// Forecast generation
// ---------------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildForecastPoints(
  lastDate: string,
  lastIndex: number,
  params: RegressionParams,
  days: number,
): ForecastPoint[] {
  const ci = 1.28 * params.residualStd // 80% confidence interval
  const points: ForecastPoint[] = []

  for (let i = 1; i <= days; i++) {
    const x = lastIndex + i
    const predicted = Math.max(0, params.slope * x + params.intercept)
    points.push({
      date: addDays(lastDate, i),
      predicted,
      lower: Math.max(0, predicted - ci),
      upper: predicted + ci,
    })
  }

  return points
}

function currentMonthTotal(historical: DailySpend[]): number {
  const now = new Date()
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  return historical
    .filter(d => d.date.startsWith(prefix))
    .reduce((acc, d) => acc + d.cost, 0)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateCostForecast(
  workspaceId: number,
  db: Database.Database,
  budgetThresholdUsd = 500,
): CostForecast {
  const historical = fetchDailySpend(workspaceId, db)

  if (historical.length === 0) {
    return {
      historical: [],
      forecast: [],
      slope: 0,
      r2: 0,
      projectedMonthTotal: 0,
      currentMonthTotal: 0,
      budgetAlert: false,
    }
  }

  const costs = historical.map(d => d.cost)
  const params = linearRegression(costs)
  const lastDate = historical[historical.length - 1].date
  const lastIndex = historical.length - 1
  const forecastPoints = buildForecastPoints(lastDate, lastIndex, params, 14)

  const mtdTotal = currentMonthTotal(historical)
  // Project remaining days of current month using regression
  const now = new Date()
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate()
  const remainingDays = daysInMonth - now.getUTCDate()
  const avgProjected = forecastPoints.slice(0, remainingDays).reduce((a, p) => a + p.predicted, 0)
  const projectedMonthTotal = mtdTotal + avgProjected

  return {
    historical,
    forecast: forecastPoints,
    slope: params.slope,
    r2: params.r2,
    projectedMonthTotal,
    currentMonthTotal: mtdTotal,
    budgetAlert: projectedMonthTotal > budgetThresholdUsd,
  }
}
