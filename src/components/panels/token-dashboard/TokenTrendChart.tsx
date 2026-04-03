'use client'

import { useTranslations } from 'next-intl'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendData, TimezoneOption, formatNumber } from './token-dashboard-types'

interface TrendPoint {
  time: string
  tokens: number
  cost: number
  requests: number
}

interface TokenTrendChartProps {
  trendData: TrendData | null
  chartMode: 'incremental' | 'cumulative'
  peakTrendHour: string | null
  selectedTimezone: TimezoneOption
  onChartModeChange: (mode: 'incremental' | 'cumulative') => void
}

function buildChartData(
  trendData: TrendData | null,
  chartMode: 'incremental' | 'cumulative',
  selectedTimezone: TimezoneOption,
): TrendPoint[] {
  if (!trendData?.trends) return []

  const raw = trendData.trends.map(trend => {
    const date = new Date(trend.timestamp)
    let time: string
    if (isNaN(selectedTimezone.offset)) {
      time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
      const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
      const adjusted = new Date(utcMs + selectedTimezone.offset * 3600000)
      time = adjusted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return { time, tokens: trend.tokens, cost: trend.cost, requests: trend.requests }
  })

  if (chartMode === 'cumulative') {
    let cumTokens = 0
    let cumCost = 0
    let cumRequests = 0
    return raw.map(d => {
      cumTokens += d.tokens
      cumCost += d.cost
      cumRequests += d.requests
      return { ...d, tokens: cumTokens, cost: cumCost, requests: cumRequests }
    })
  }

  return raw
}

export function TokenTrendChart({
  trendData,
  chartMode,
  peakTrendHour,
  selectedTimezone,
  onChartModeChange,
}: TokenTrendChartProps): React.JSX.Element {
  const t = useTranslations('tokenDashboard')
  const chartData = buildChartData(trendData, chartMode, selectedTimezone)

  return (
    <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('usageTrends', { timeframe: trendData?.timeframe || '' })}</h2>
        <div className="flex items-center gap-3">
          {peakTrendHour && (
            <span className="text-xs text-muted-foreground">
              {t('peakLabel')} <span className="text-foreground font-medium">{peakTrendHour}</span>
            </span>
          )}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => onChartModeChange('incremental')}
              className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'incremental' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
            >
              {t('perTurnButton')}
            </button>
            <button
              onClick={() => onChartModeChange('cumulative')}
              className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'cumulative' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
            >
              {t('cumulativeButton')}
            </button>
          </div>
        </div>
      </div>
      <div className="h-64">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="tokens"
                stroke="#8884d8"
                strokeWidth={2}
                name={t('chartTokens')}
              />
              <Line
                type="monotone"
                dataKey="requests"
                stroke="#82ca9d"
                strokeWidth={2}
                name={t('chartRequests')}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// Re-export for parent to compute peakTrendHour without duplicating timezone logic
export function formatTimestampWithTimezone(isoString: string, selectedTimezone: TimezoneOption): string {
  const date = new Date(isoString)
  if (isNaN(selectedTimezone.offset)) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const adjusted = new Date(utcMs + selectedTimezone.offset * 3600000)
  return adjusted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Silence unused import warning — formatNumber is re-exported for parent use if needed
export { formatNumber }
