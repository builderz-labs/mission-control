'use client'

/**
 * Lionroot Usage Ledger Panel
 *
 * Multi-source token usage dashboard showing costs across:
 * Claude CLI, Codex CLI, Gemini CLI, Ollama, CodexBar, and more.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

/* ── Types (mirrors API response) ── */

type ServiceId =
  | 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'cursor-cli'
  | 'ollama' | 'zulip-bot' | 'clawdbot' | 'cron' | 'other'

const SERVICE_LABELS: Record<ServiceId, string> = {
  'claude-cli': 'Claude', 'codex-cli': 'Codex', 'gemini-cli': 'Gemini',
  'cursor-cli': 'Cursor', ollama: 'Ollama', 'zulip-bot': 'Zulip',
  clawdbot: 'ClawdBot', cron: 'Cron', other: 'Other',
}

const SERVICE_COLORS: Record<ServiceId, string> = {
  'claude-cli': '#3b82f6', 'codex-cli': '#10b981', 'gemini-cli': '#f59e0b',
  'cursor-cli': '#8b5cf6', ollama: '#ef4444', 'zulip-bot': '#06b6d4',
  clawdbot: '#ec4899', cron: '#6366f1', other: '#9ca3af',
}

type ServiceStats = {
  totalCost: number; totalTokens: number; totalRequests: number;
  models: string[]; avgCostPerRequest: number; sessionCount: number;
  dailySpark: number[];
}

type DailyBucket = {
  date: string; totalCost: number; totalTokens: number; totalRequests: number;
  byService: Record<ServiceId, { cost: number; tokens: number; requests: number }>;
}

type SessionRollup = {
  sessionId: string; label: string; service: ServiceId;
  lastActivityAt: string; totalTokens: number; totalCost: number;
  messageCount: number; model?: string;
}

type CostInsights = {
  costPer1kTokens: Record<string, number>;
  cacheHitRate: number; cacheSavingsEstimate: number;
  projectedMonthlyCost: number;
  topCostDrivers: Array<{ label: string; cost: number; pctOfTotal: number }>;
  wasteIndicators: Array<{ type: string; description: string; estimatedWaste: number }>;
}

type LedgerData = {
  total: number;
  summary: { totalCost: number; totalTokens: number; totalRequests: number };
  daily: DailyBucket[];
  sessions: SessionRollup[];
  byService: Record<ServiceId, ServiceStats>;
  insights: CostInsights;
}

/* ── Helpers ── */

function formatCost(n: number): string {
  if (n >= 100) return '$' + n.toFixed(0)
  if (n >= 1) return '$' + n.toFixed(2)
  if (n >= 0.01) return '$' + n.toFixed(3)
  return '$' + n.toFixed(4)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/* ── Sparkline (tiny inline chart) ── */

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 0.001)
  const w = 60
  const h = 16
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="inline-block ml-1">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

/* ── Main Panel ── */

export function UsageLedgerPanel() {
  const [data, setData] = useState<LedgerData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'insights'>('overview')

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/lionroot/usage-ledger?days=${days}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [days])

  useEffect(() => { loadData() }, [loadData])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        <div className="text-center">
          <p className="text-lg font-semibold">Usage Ledger Error</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={loadData} className="mt-3 px-3 py-1 bg-zinc-700 rounded text-sm hover:bg-zinc-600">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg">Loading usage data...</p>
          <p className="text-sm mt-1">Scanning Claude, Codex, Gemini, Ollama...</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { summary, daily, sessions, byService, insights } = data

  // Pie chart: service cost breakdown (only services with cost > 0)
  const pieData = (Object.entries(byService) as [ServiceId, ServiceStats][])
    .filter(([, s]) => s.totalCost > 0 || s.totalTokens > 0)
    .map(([id, s]) => ({ name: SERVICE_LABELS[id], value: s.totalCost, fill: SERVICE_COLORS[id] }))
    .sort((a, b) => b.value - a.value)

  // Stacked bar chart: daily costs by service
  const dailyChartData = [...daily]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14) // Last 14 days
    .map((d) => ({
      date: d.date.slice(5), // MM-DD
      ...Object.fromEntries(
        (Object.entries(d.byService) as [ServiceId, { cost: number }][])
          .map(([id, s]) => [id, Math.round(s.cost * 100) / 100])
      ),
    }))

  const activeServices = (Object.entries(byService) as [ServiceId, ServiceStats][])
    .filter(([, s]) => s.totalCost > 0 || s.totalTokens > 0)
    .sort(([, a], [, b]) => b.totalCost - a.totalCost)

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Usage Ledger</h2>
          <p className="text-xs text-muted-foreground">
            {data.total} entries across {activeServices.length} services
            {isLoading && ' • refreshing...'}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-xs rounded ${
                days === d ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {d}d
            </button>
          ))}
          <button onClick={loadData} className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700">
            ↻
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Total Cost" value={formatCost(summary.totalCost)} />
        <SummaryCard label="Tokens" value={formatTokens(summary.totalTokens)} />
        <SummaryCard label="Projected/mo" value={formatCost(insights.projectedMonthlyCost)} />
        <SummaryCard label="Cache Hit" value={`${(insights.cacheHitRate * 100).toFixed(0)}%`} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-700">
        {(['overview', 'sessions', 'insights'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm capitalize ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Service pills */}
          <div className="flex flex-wrap gap-2">
            {activeServices.map(([id, stats]) => (
              <div
                key={id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERVICE_COLORS[id] }} />
                <span className="text-sm font-medium">{SERVICE_LABELS[id]}</span>
                <span className="text-xs text-zinc-400">{formatCost(stats.totalCost)}</span>
                <Sparkline data={stats.dailySpark} color={SERVICE_COLORS[id]} />
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-4">
            {/* Daily stacked bar */}
            <div className="col-span-2 bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-2">Daily Cost by Service (last 14d)</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#888' }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #333', borderRadius: 8 }}
                    formatter={((value: number | undefined, name: string | undefined) => [
                      formatCost(value ?? 0),
                      SERVICE_LABELS[(name ?? '') as ServiceId] || name || '',
                    ]) as never}
                  />
                  {activeServices.map(([id]) => (
                    <Bar key={id} dataKey={id} stackId="a" fill={SERVICE_COLORS[id]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-2">Cost Breakdown</p>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Legend
                      formatter={(value) => <span className="text-xs text-zinc-300">{value}</span>}
                    />
                    <Tooltip formatter={((v: number | undefined) => formatCost(v ?? 0)) as never} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-zinc-500 text-sm">
                  No cost data yet
                </div>
              )}
            </div>
          </div>

          {/* Top cost drivers */}
          {insights.topCostDrivers.length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-2">Top Cost Drivers</p>
              <div className="space-y-1">
                {insights.topCostDrivers.slice(0, 5).map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${Math.max(d.pctOfTotal, 2)}%`, maxWidth: '60%' }}
                    />
                    <span className="text-xs text-zinc-300 min-w-[120px]">{d.label}</span>
                    <span className="text-xs text-zinc-500">{formatCost(d.cost)}</span>
                    <span className="text-xs text-zinc-600">{d.pctOfTotal.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="text-center text-zinc-500 py-8">No sessions in this period</div>
          ) : (
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-xs">
                    <th className="text-left p-2">Service</th>
                    <th className="text-left p-2">Session</th>
                    <th className="text-right p-2">Tokens</th>
                    <th className="text-right p-2">Cost</th>
                    <th className="text-right p-2">Msgs</th>
                    <th className="text-right p-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.slice(0, 50).map((s) => (
                    <tr key={s.sessionId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="p-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                          style={{
                            backgroundColor: SERVICE_COLORS[s.service] + '20',
                            color: SERVICE_COLORS[s.service],
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SERVICE_COLORS[s.service] }} />
                          {SERVICE_LABELS[s.service]}
                        </span>
                      </td>
                      <td className="p-2 text-zinc-300 max-w-[300px] truncate" title={s.label}>
                        {s.label}
                      </td>
                      <td className="p-2 text-right text-zinc-400 font-mono text-xs">
                        {formatTokens(s.totalTokens)}
                      </td>
                      <td className="p-2 text-right text-zinc-300 font-mono text-xs">
                        {formatCost(s.totalCost)}
                      </td>
                      <td className="p-2 text-right text-zinc-400 text-xs">{s.messageCount}</td>
                      <td className="p-2 text-right text-zinc-500 text-xs">{timeAgo(s.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-4">
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400">Cache Hit Rate</p>
              <p className="text-2xl font-bold mt-1">{(insights.cacheHitRate * 100).toFixed(1)}%</p>
              <p className="text-xs text-zinc-500 mt-1">
                Saving ~{formatCost(insights.cacheSavingsEstimate)}
              </p>
            </div>
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400">Projected Monthly</p>
              <p className="text-2xl font-bold mt-1">{formatCost(insights.projectedMonthlyCost)}</p>
              <p className="text-xs text-zinc-500 mt-1">Based on last 7d</p>
            </div>
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400">Waste Signals</p>
              <p className="text-2xl font-bold mt-1">{insights.wasteIndicators.length}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {insights.wasteIndicators.length > 0
                  ? `~${formatCost(insights.wasteIndicators.reduce((a, w) => a + w.estimatedWaste, 0))} recoverable`
                  : 'Looking good'}
              </p>
            </div>
          </div>

          {/* Waste indicators */}
          {insights.wasteIndicators.length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-2">Waste Indicators</p>
              <div className="space-y-2">
                {insights.wasteIndicators.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-yellow-500 mt-0.5">⚠</span>
                    <div>
                      <p className="text-zinc-300">{w.description}</p>
                      {w.estimatedWaste > 0 && (
                        <p className="text-xs text-zinc-500">~{formatCost(w.estimatedWaste)} estimated</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost per 1k tokens by model */}
          {Object.keys(insights.costPer1kTokens || {}).length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-2">Cost per 1K Tokens by Model</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(insights.costPer1kTokens)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 10)
                  .map(([model, cost]) => (
                    <div key={model} className="flex justify-between text-xs">
                      <span className="text-zinc-300 truncate mr-2">{model}</span>
                      <span className="text-zinc-500 font-mono">{formatCost(cost)}/1k</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Summary card component ── */

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  )
}
