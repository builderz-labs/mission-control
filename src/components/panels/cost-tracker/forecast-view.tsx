'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { CostForecast } from '@/lib/cost-forecast'

const DEFAULT_BUDGET = 500

// ---------------------------------------------------------------------------
// Budget input — persists to localStorage
// ---------------------------------------------------------------------------

function useBudget(): [number, (v: number) => void] {
  const [budget, setBudgetState] = useState<number>(DEFAULT_BUDGET)

  useEffect(() => {
    const stored = localStorage.getItem('costForecastBudget')
    if (stored) setBudgetState(parseFloat(stored))
  }, [])

  const setBudget = useCallback((v: number) => {
    setBudgetState(v)
    localStorage.setItem('costForecastBudget', String(v))
  }, [])

  return [budget, setBudget]
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ForecastSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-48 rounded-lg bg-muted" />
      <div className="h-10 rounded bg-muted w-64" />
      <div className="h-8 rounded bg-muted w-full" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary row
// ---------------------------------------------------------------------------

interface SummaryProps {
  forecast: CostForecast
}

function ForecastSummary({ forecast }: SummaryProps) {
  const trendUp = forecast.slope > 0
  const arrow = trendUp ? '↑' : forecast.slope < 0 ? '↓' : '→'
  const arrowColor = trendUp ? 'text-red-400' : forecast.slope < 0 ? 'text-green-400' : 'text-muted-foreground'
  const r2Label = forecast.r2 >= 0.8 ? 'High' : forecast.r2 >= 0.5 ? 'Medium' : 'Low'
  const r2Color = forecast.r2 >= 0.8 ? 'text-green-400' : forecast.r2 >= 0.5 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-card px-5 py-4 text-sm">
      <div>
        <span className="text-muted-foreground">Month to date</span>
        <p className="text-lg font-semibold text-foreground">${forecast.currentMonthTotal.toFixed(2)}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Projected this month</span>
        <p className="text-lg font-semibold text-foreground">
          ${forecast.projectedMonthTotal.toFixed(2)}
          <span className={`ml-1.5 text-base ${arrowColor}`}>{arrow}</span>
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Daily trend</span>
        <p className="font-semibold text-foreground">
          {forecast.slope >= 0 ? '+' : ''}{(forecast.slope * 100).toFixed(3)}¢/day
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Forecast quality (R²)</span>
        <p className={`font-semibold ${r2Color}`}>{r2Label} ({forecast.r2.toFixed(2)})</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart — historical bars + forecast line + CI area
// ---------------------------------------------------------------------------

interface ChartEntry {
  date: string
  historical?: number
  predicted?: number
  lower?: number
  upper?: number
}

function buildChartData(forecast: CostForecast): ChartEntry[] {
  const hist: ChartEntry[] = forecast.historical.map(d => ({
    date: d.date.slice(5),   // MM-DD for brevity
    historical: d.cost,
  }))

  const proj: ChartEntry[] = forecast.forecast.map(p => ({
    date: p.date.slice(5),
    predicted: p.predicted,
    lower: p.lower,
    upper: p.upper,
  }))

  return [...hist, ...proj]
}

interface ChartProps {
  forecast: CostForecast
}

function SpendChart({ forecast }: ChartProps) {
  const data = buildChartData(forecast)

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#888' }} tickFormatter={v => `$${v.toFixed(2)}`} width={62} />
        <Tooltip formatter={(v) => typeof v === 'number' ? `$${v.toFixed(4)}` : v} contentStyle={{ background: '#1a1a2e', border: '1px solid #333' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="historical" name="Historical" fill="#3B82F6" opacity={0.75} maxBarSize={18} />
        <Area dataKey="upper" name="CI upper" fill="#F59E0B" stroke="none" opacity={0.15} legendType="none" />
        <Area dataKey="lower" name="CI lower" fill="#1a1a2e" stroke="none" opacity={1} legendType="none" />
        <Line dataKey="predicted" name="Forecast" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="4 2" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Budget input
// ---------------------------------------------------------------------------

interface BudgetInputProps {
  budget: number
  onChange: (v: number) => void
}

function BudgetInput({ budget, onChange }: BudgetInputProps) {
  const [raw, setRaw] = useState(String(budget))

  const handleBlur = () => {
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed > 0) onChange(parsed)
    else setRaw(String(budget))
  }

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-muted-foreground whitespace-nowrap">Budget ceiling ($/month)</label>
      <input
        type="number"
        min={1}
        step={10}
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={handleBlur}
        className="w-28 rounded border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ForecastView() {
  const [budget, setBudget] = useBudget()
  const [forecast, setForecast] = useState<CostForecast | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (bgt: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tokens/forecast?budget=${bgt}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as CostForecast
      setForecast(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forecast')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load(budget) }, [budget, load])

  const handleBudgetChange = (v: number) => {
    setBudget(v)
    load(v)
  }

  if (isLoading) return <ForecastSkeleton />

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-3">
        <span className="flex-1">{error}</span>
        <button onClick={() => load(budget)} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">
          Retry
        </button>
      </div>
    )
  }

  if (!forecast) return null

  const hasData = forecast.historical.length > 0

  return (
    <div className="space-y-5">
      {forecast.budgetAlert && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300 flex items-center gap-2">
          <span className="text-base">⚠</span>
          <span>
            Projected monthly spend <strong>${forecast.projectedMonthTotal.toFixed(2)}</strong> exceeds your budget ceiling of <strong>${budget.toFixed(2)}</strong>.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">30-day spend + 14-day forecast</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Linear regression on daily token cost data</p>
        </div>
        <BudgetInput budget={budget} onChange={handleBudgetChange} />
      </div>

      {hasData ? (
        <>
          <SpendChart forecast={forecast} />
          <ForecastSummary forecast={forecast} />
        </>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-base mb-1">No cost data yet</p>
          <p className="text-xs max-w-sm mx-auto">Token usage will appear here once agents start processing tasks.</p>
        </div>
      )}
    </div>
  )
}
