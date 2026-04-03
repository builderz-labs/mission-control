'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import { COLORS, formatNumber, formatCost, getModelDisplayName } from './helpers'
import type { UsageStats, TrendData, ByAgentResponse, TaskCostsResponse, Timeframe } from './types'

interface Props {
  stats: UsageStats | null
  trendData: TrendData | null
  agentSummary: ByAgentResponse['summary'] | undefined
  taskData: TaskCostsResponse | null
  timeframe: Timeframe
  chartMode: 'incremental' | 'cumulative'
  setChartMode: (m: 'incremental' | 'cumulative') => void
  exportData: (f: 'json' | 'csv') => void
  isExporting: boolean
  onRefresh: () => void
}

export function OverviewView({
  stats, trendData, agentSummary, taskData, timeframe, chartMode, setChartMode,
  exportData, isExporting, onRefresh,
}: Props) {
  const t = useTranslations('costTracker')

  if (!stats) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noUsageData')}</div>
        <div className="text-sm max-w-sm mx-auto">{t('noUsageDataDesc')}</div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="mt-4 text-xs">{t('refresh')}</Button>
      </div>
    )
  }

  const modelData = Object.entries(stats.models)
    .map(([model, s]) => ({
      name: getModelDisplayName(model), fullName: model,
      tokens: s.totalTokens, cost: s.totalCost, requests: s.requestCount,
    }))
    .sort((a, b) => b.cost - a.cost)

  const pieData = modelData.slice(0, 6).map(m => ({ name: m.name, value: m.cost }))

  const trendChartData = (() => {
    if (!trendData?.trends) return []
    const raw = trendData.trends.map(d => ({
      time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tokens: d.tokens, cost: d.cost, requests: d.requests,
    }))
    if (chartMode === 'cumulative') {
      let ct = 0, cc = 0, cr = 0
      return raw.map(d => {
        ct += d.tokens; cc += d.cost; cr += d.requests
        return { ...d, tokens: ct, cost: cc, requests: cr }
      })
    }
    return raw
  })()

  const models = Object.entries(stats.models)
  const mostEfficient = models.length > 0
    ? models.reduce((best, curr) => {
        const c = curr[1].totalCost / Math.max(1, curr[1].totalTokens)
        const b = best[1].totalCost / Math.max(1, best[1].totalTokens)
        return c < b ? curr : best
      })
    : null
  const efficientCostPerToken = mostEfficient
    ? mostEfficient[1].totalCost / Math.max(1, mostEfficient[1].totalTokens)
    : 0
  const potentialSavings = Math.max(
    0,
    stats.summary.totalCost - stats.summary.totalTokens * efficientCostPerToken,
  )

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(stats.summary.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCost', { timeframe })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.requestCount)}</div>
          <div className="text-sm text-muted-foreground">{t('apiRequests')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{agentSummary?.agent_count ?? '-'}</div>
          <div className="text-sm text-muted-foreground">{t('activeAgents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {taskData
              ? `${((1 - taskData.unattributed.totalCost / Math.max(stats.summary.totalCost, 0.0001)) * 100).toFixed(0)}%`
              : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('taskAttributed')}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trend chart */}
        <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t('usageTrends')}</h2>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(['incremental', 'cumulative'] as const).map(m => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={`px-2 py-1 text-[10px] font-medium ${chartMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >{m === 'incremental' ? t('perTurn') : t('cumulative')}</button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {trendChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" /><YAxis />
                  <Tooltip /><Legend />
                  <Line type="monotone" dataKey="tokens" stroke="#8884d8" strokeWidth={2} name="Tokens" />
                  <Line type="monotone" dataKey="requests" stroke="#82ca9d" strokeWidth={2} name="Requests" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Model bar chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('tokenUsageByModel')}</h2>
          <div className="h-64">
            {modelData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noModelData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                  <YAxis />
                  <Tooltip formatter={(v, n) => [formatNumber(Number(v)), n]} />
                  <Bar dataKey="tokens" fill="#8884d8" name="Tokens" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Cost pie */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('costDistributionByModel')}</h2>
          <div className="h-64">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={5} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCost(Number(v))} /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Performance insights */}
      {models.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('performanceInsights')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('mostEfficientModel')}</div>
              <div className="text-lg font-bold text-green-500">
                {mostEfficient ? getModelDisplayName(mostEfficient[0]) : '-'}
              </div>
              {mostEfficient && (
                <div className="text-xs text-muted-foreground">
                  ${(efficientCostPerToken * 1000).toFixed(4)}/1K tokens
                </div>
              )}
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('avgTokensPerRequest')}</div>
              <div className="text-lg font-bold text-foreground">{formatNumber(stats.summary.avgTokensPerRequest)}</div>
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('optimizationPotential')}</div>
              <div className="text-lg font-bold text-orange-500">{formatCost(potentialSavings)}</div>
              <div className="text-xs text-muted-foreground">
                {stats.summary.totalCost > 0
                  ? ((potentialSavings / stats.summary.totalCost) * 100).toFixed(1)
                  : '0'}% {t('savingsPossible')}
              </div>
            </div>
          </div>
          {/* Model efficiency bars */}
          <div className="space-y-2">
            {modelData.map(m => {
              const costPer1k = m.cost / Math.max(1, m.tokens) * 1000
              const maxCostPer1k = Math.max(
                ...modelData.map(d => d.cost / Math.max(1, d.tokens) * 1000),
                0.0001,
              )
              return (
                <div key={m.fullName} className="flex items-center text-sm">
                  <div className="w-32 truncate text-muted-foreground">{m.name}</div>
                  <div className="flex-1 mx-3">
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(costPer1k / maxCostPer1k) * 100}%` }} />
                    </div>
                  </div>
                  <div className="w-20 text-right text-xs text-muted-foreground">${costPer1k.toFixed(4)}/1K</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('exportData')}</h2>
            <p className="text-sm text-muted-foreground">{t('exportDataDesc')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportData('csv')} disabled={isExporting} size="sm" variant="secondary">
              {isExporting ? t('exporting') : 'CSV'}
            </Button>
            <Button onClick={() => exportData('json')} disabled={isExporting} size="sm" variant="secondary">
              {isExporting ? t('exporting') : 'JSON'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
