import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

interface BacktestRow {
  id: number
  strategy: string
  exchange: string
  symbol: string
  timeframe: string
  status: string
  metrics: string
  cost_breakdown: string
  created_at: number
  completed_at: number | null
  error: string | null
}

interface BacktestResult extends Omit<BacktestRow, 'metrics' | 'cost_breakdown'> {
  metrics: Record<string, unknown>
  cost_breakdown: Record<string, unknown>
}

interface JobEntry {
  id: number | bigint
  strategy: string
  symbol: string
}

function ensureBacktestTable(): void {
  const db = getDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL,
      exchange TEXT DEFAULT 'hyperliquid',
      symbol TEXT DEFAULT 'BTC',
      timeframe TEXT DEFAULT '15m',
      status TEXT DEFAULT 'queued',
      metrics TEXT DEFAULT '{}',
      cost_breakdown TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      error TEXT
    )
  `)
}

function parseRow(row: BacktestRow): BacktestResult {
  return {
    ...row,
    metrics: JSON.parse(row.metrics || '{}') as Record<string, unknown>,
    cost_breakdown: JSON.parse(row.cost_breakdown || '{}') as Record<string, unknown>,
  }
}

/**
 * GET /api/backtest - List backtest results
 * Query params:
 *   strategy  - filter by strategy name
 *   limit     - max rows to return (default 50)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    ensureBacktestTable()
    const db = getDatabase()

    const url = new URL(request.url)
    const strategy = url.searchParams.get('strategy')
    const limitParam = url.searchParams.get('limit')
    const limit = Math.max(1, Math.min(500, parseInt(limitParam || '50', 10) || 50))

    let rows: BacktestRow[]
    if (strategy) {
      rows = db
        .prepare(
          'SELECT * FROM backtest_results WHERE strategy = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(strategy, limit) as BacktestRow[]
    } else {
      rows = db
        .prepare('SELECT * FROM backtest_results ORDER BY created_at DESC LIMIT ?')
        .all(limit) as BacktestRow[]
    }

    const results: BacktestResult[] = rows.map(parseRow)

    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch backtest results' }, { status: 500 })
  }
}

/**
 * POST /api/backtest - Trigger a backtest run
 * Body: {
 *   action: 'run_all' | 'run_single'
 *   strategy?: string      (required for run_single)
 *   exchange?: string      (default: 'hyperliquid')
 *   symbol?: string        (default: 'BTC')
 *   timeframe?: string     (default: '15m')
 * }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body?.action
  if (action !== 'run_all' && action !== 'run_single') {
    return NextResponse.json(
      { error: 'action must be run_all or run_single' },
      { status: 400 }
    )
  }

  try {
    ensureBacktestTable()
    const db = getDatabase()
    const now = Date.now()

    if (action === 'run_all') {
      const strategies = ['momentum', 'mean_reversion', 'rbi_v1', 'breakout', 'grid']
      const symbols = ['BTC', 'ETH', 'SOL']
      const exchange = typeof body.exchange === 'string' ? body.exchange : 'hyperliquid'

      const insert = db.prepare(
        'INSERT INTO backtest_results (strategy, exchange, symbol, timeframe, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )

      const jobs: JobEntry[] = []
      const insertMany = db.transaction(() => {
        for (const strat of strategies) {
          for (const sym of symbols) {
            const result = insert.run(strat, exchange, sym, '15m', 'queued', now)
            jobs.push({ id: result.lastInsertRowid, strategy: strat, symbol: sym })
          }
        }
      })
      insertMany()

      return NextResponse.json({ success: true, jobs, status: 'queued', job_count: jobs.length })
    }

    // action === 'run_single'
    if (!body.strategy || typeof body.strategy !== 'string') {
      return NextResponse.json({ error: 'strategy is required for run_single' }, { status: 400 })
    }

    const result = db
      .prepare(
        'INSERT INTO backtest_results (strategy, exchange, symbol, timeframe, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        body.strategy,
        typeof body.exchange === 'string' ? body.exchange : 'hyperliquid',
        typeof body.symbol === 'string' ? body.symbol : 'BTC',
        typeof body.timeframe === 'string' ? body.timeframe : '15m',
        'queued',
        now
      )

    return NextResponse.json({
      success: true,
      job_id: result.lastInsertRowid,
      status: 'queued',
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to queue backtest job' }, { status: 500 })
  }
}
