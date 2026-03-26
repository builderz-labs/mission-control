'use client'

import { useState, useEffect } from 'react'
import { DataTable, Column } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'

// ── Types ──────────────────────────────────────────────────────────────

interface BacktestResult {
  id: string
  strategy: string
  exchange: string
  symbol: string
  timeframe: string
  created_at: number
  status: 'completed' | 'running' | 'failed'
  metrics: {
    roi: number
    roi_gross?: number
    max_drawdown: number
    sharpe_ratio: number
    sortino_ratio: number
    total_trades: number
    win_rate: number
    profit_factor: number
    total_pnl: number
    avg_pnl: number
    expected_value_pct: number
    calmar_ratio: number
    sqn: number
  }
  cost_breakdown?: {
    fees_usd: number
    slippage_usd: number
    funding_usd: number
    total_usd: number
    roi_impact_pct: number
  }
}

interface BacktestResultsPanelProps {
  className?: string
}

// ── Helper formatters ──────────────────────────────────────────────────

function fmt2(n: number): string {
  return n.toFixed(2)
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function roiColor(n: number): string {
  if (n > 0) return 'text-[#22c55e]'
  if (n < 0) return 'text-[#ef4444]'
  return 'text-[var(--text-secondary)]'
}

function mapBacktestStatus(status: BacktestResult['status']): 'running' | 'busy' | 'crashed' {
  switch (status) {
    case 'completed': return 'running'
    case 'running': return 'busy'
    case 'failed': return 'crashed'
  }
}

// ── Summary strip ──────────────────────────────────────────────────────

function SummaryStat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={`text-sm font-mono tabular-nums text-[var(--text-primary)] ${valueClass ?? ''}`}>
        {value}
      </span>
    </div>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────

interface DetailRowProps {
  label: string
  value: string
  valueClass?: string
}

function DetailRow({ label, value, valueClass }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-sm tabular-nums text-[var(--text-primary)] ${valueClass ?? ''}`}>
        {value}
      </span>
    </div>
  )
}

interface BacktestDetailPanelProps {
  result: BacktestResult
  onClose: () => void
}

function BacktestDetailPanel({ result, onClose }: BacktestDetailPanelProps) {
  const m = result.metrics
  const cb = result.cost_breakdown

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        className="fixed right-0 top-0 h-full w-[360px] z-50 flex flex-col bg-[var(--surface)] border-l border-[var(--border)]"
        style={{ transform: 'translateX(0)', transition: 'transform 200ms ease-out' }}
        role="dialog"
        aria-modal="true"
        aria-label={`Backtest detail: ${result.strategy}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-4 py-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
                {result.strategy}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={mapBacktestStatus(result.status)} />
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {result.symbol} · {result.timeframe} · {result.exchange}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded transition-colors duration-150"
              aria-label="Close detail panel"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Core metrics */}
          <div className="px-4 py-4 border-b border-[var(--border)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">Performance</p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow
                label="ROI (Net)"
                value={fmtPct(m.roi)}
                valueClass={roiColor(m.roi)}
              />
              {m.roi_gross != null && (
                <DetailRow
                  label="ROI (Gross)"
                  value={fmtPct(m.roi_gross)}
                  valueClass={roiColor(m.roi_gross)}
                />
              )}
              <DetailRow
                label="Total PnL"
                value={fmtUsd(m.total_pnl)}
                valueClass={roiColor(m.total_pnl)}
              />
              <DetailRow
                label="Avg PnL"
                value={fmtUsd(m.avg_pnl)}
                valueClass={roiColor(m.avg_pnl)}
              />
              <DetailRow
                label="Max Drawdown"
                value={fmtPct(m.max_drawdown)}
                valueClass="text-[#ef4444]"
              />
              <DetailRow label="Win Rate" value={fmtPct(m.win_rate)} />
              <DetailRow label="Total Trades" value={String(m.total_trades)} />
              <DetailRow label="Profit Factor" value={fmt2(m.profit_factor)} />
            </div>
          </div>

          {/* Risk metrics */}
          <div className="px-4 py-4 border-b border-[var(--border)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">Risk Ratios</p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Sharpe" value={fmt2(m.sharpe_ratio)} />
              <DetailRow label="Sortino" value={fmt2(m.sortino_ratio)} />
              <DetailRow label="Calmar" value={fmt2(m.calmar_ratio)} />
              <DetailRow label="SQN" value={fmt2(m.sqn)} />
              <DetailRow
                label="Expected Value"
                value={fmtPct(m.expected_value_pct)}
                valueClass={roiColor(m.expected_value_pct)}
              />
            </div>
          </div>

          {/* Cost breakdown */}
          {cb && (
            <div className="px-4 py-4 border-b border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">Cost Breakdown</p>
              <div className="grid grid-cols-2 gap-3">
                <DetailRow label="Fees" value={fmtUsd(cb.fees_usd)} valueClass="text-[#ef4444]" />
                <DetailRow label="Slippage" value={fmtUsd(cb.slippage_usd)} valueClass="text-[#f59e0b]" />
                <DetailRow label="Funding" value={fmtUsd(cb.funding_usd)} valueClass="text-[#f59e0b]" />
                <DetailRow label="Total Cost" value={fmtUsd(cb.total_usd)} valueClass="text-[#ef4444]" />
                <DetailRow
                  label="ROI Impact"
                  value={fmtPct(cb.roi_impact_pct)}
                  valueClass="text-[#ef4444]"
                />
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="px-4 py-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">Metadata</p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Exchange" value={result.exchange} />
              <DetailRow label="Symbol" value={result.symbol} />
              <DetailRow label="Timeframe" value={result.timeframe} />
              <DetailRow
                label="Created"
                value={new Date(result.created_at * 1000).toLocaleDateString()}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Table row type ─────────────────────────────────────────────────────

// DataTable requires Record<string, unknown> — we expose flattened rows
interface BacktestRow extends Record<string, unknown> {
  id: string
  strategy: string
  symbol: string
  roi: number
  roi_gross: number | null
  sharpe: number
  max_drawdown: number
  win_rate: number
  total_trades: number
  profit_factor: number
  status: BacktestResult['status']
  _raw: BacktestResult
}

function toRow(r: BacktestResult): BacktestRow {
  return {
    id: r.id,
    strategy: r.strategy,
    symbol: r.symbol,
    roi: r.metrics.roi,
    roi_gross: r.metrics.roi_gross ?? null,
    sharpe: r.metrics.sharpe_ratio,
    max_drawdown: r.metrics.max_drawdown,
    win_rate: r.metrics.win_rate,
    total_trades: r.metrics.total_trades,
    profit_factor: r.metrics.profit_factor,
    status: r.status,
    _raw: r,
  }
}

// ── Main panel ─────────────────────────────────────────────────────────

export function BacktestResultsPanel({ className = '' }: BacktestResultsPanelProps) {
  const [results, setResults] = useState<BacktestResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // ── Fetch on mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/backtest')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.results) setResults(data.results)
      })
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  // ── Run backtest handler ─────────────────────────────────────────────
  const handleRunBacktest = async () => {
    setIsRunning(true)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_all' }),
      })
      if (res.ok) {
        setTimeout(() => {
          fetch('/api/backtest')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.results) setResults(d.results) })
        }, 2000)
      }
    } finally {
      setIsRunning(false)
    }
  }

  // ── Derived: summary stats ───────────────────────────────────────────
  const completed = results.filter(r => r.status === 'completed')
  const avgRoi = completed.length > 0
    ? completed.reduce((sum, r) => sum + r.metrics.roi, 0) / completed.length
    : 0
  const avgSharpe = completed.length > 0
    ? completed.reduce((sum, r) => sum + r.metrics.sharpe_ratio, 0) / completed.length
    : 0
  const avgWinRate = completed.length > 0
    ? completed.reduce((sum, r) => sum + r.metrics.win_rate, 0) / completed.length
    : 0

  // ── Table columns ────────────────────────────────────────────────────
  const columns: Column<BacktestRow>[] = [
    {
      key: 'strategy',
      label: 'Strategy',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-primary)]">{String(row.strategy)}</span>
      ),
    },
    {
      key: 'symbol',
      label: 'Symbol',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-secondary)]">{String(row.symbol)}</span>
      ),
    },
    {
      key: 'roi',
      label: 'ROI %',
      sortable: true,
      numeric: true,
      render: (row) => {
        const roi = row.roi as number
        const roiGross = row.roi_gross as number | null
        return (
          <span className={`font-mono text-xs tabular-nums ${roiColor(roi)}`}>
            {fmtPct(roi)}
            {roiGross != null && (
              <span className="text-[var(--text-muted)] ml-1">
                ({fmtPct(roiGross)})
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'sharpe',
      label: 'Sharpe',
      sortable: true,
      numeric: true,
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {fmt2(row.sharpe as number)}
        </span>
      ),
    },
    {
      key: 'max_drawdown',
      label: 'Max DD %',
      sortable: true,
      numeric: true,
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[#ef4444]">
          {fmtPct(row.max_drawdown as number)}
        </span>
      ),
    },
    {
      key: 'win_rate',
      label: 'Win Rate',
      sortable: true,
      numeric: true,
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {fmtPct(row.win_rate as number)}
        </span>
      ),
    },
    {
      key: 'total_trades',
      label: 'Trades',
      sortable: true,
      numeric: true,
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {String(row.total_trades)}
        </span>
      ),
    },
    {
      key: 'profit_factor',
      label: 'PF',
      sortable: true,
      numeric: true,
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {fmt2(row.profit_factor as number)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => (
        <StatusBadge status={mapBacktestStatus(row.status as BacktestResult['status'])} />
      ),
    },
  ]

  // ── Selected result for detail panel ─────────────────────────────────
  const selectedResult = selectedStrategy
    ? results.find(r => r.id === selectedStrategy) ?? null
    : null

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
        <span className="text-sm font-medium text-[var(--text-primary)]">Backtest Results</span>
        <button
          onClick={handleRunBacktest}
          disabled={isRunning}
          className="px-3 py-1 text-xs border border-[#3b82f6]/50 text-[#3b82f6] rounded hover:bg-[#3b82f6]/10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Run all backtests"
        >
          {isRunning ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {/* Summary strip */}
      {results.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-2 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg,#0f1117)]">
          <SummaryStat label="Total Runs" value={String(results.length)} />
          <SummaryStat
            label="Avg ROI"
            value={fmtPct(avgRoi)}
            valueClass={roiColor(avgRoi)}
          />
          <SummaryStat label="Avg Sharpe" value={fmt2(avgSharpe)} />
          <SummaryStat label="Avg Win Rate" value={fmtPct(avgWinRate)} />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-[var(--text-muted)] animate-pulse">Loading results...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-sm text-[#ef4444]">Error loading results</span>
            <span className="font-mono text-xs text-[var(--text-muted)]">{error}</span>
          </div>
        ) : (
          <DataTable<BacktestRow>
            columns={columns}
            data={results.map(toRow)}
            keyField="id"
            emptyMessage="No backtest results yet. Run a backtest to see results here."
            emptyAction={{ label: 'Run a backtest now', onClick: handleRunBacktest }}
            maxHeight="calc(100vh - 200px)"
            onRowClick={(row) => setSelectedStrategy(String(row.id))}
          />
        )}
      </div>

      {/* Detail panel */}
      {selectedResult && (
        <BacktestDetailPanel
          result={selectedResult}
          onClose={() => setSelectedStrategy(null)}
        />
      )}
    </div>
  )
}

export default BacktestResultsPanel
