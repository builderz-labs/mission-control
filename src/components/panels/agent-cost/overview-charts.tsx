'use client'

import type { JSX } from 'react'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import type { PieSlice, TrendPoint, EfficiencyBar } from './types'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

interface OverviewChartsProps {
  pieData: PieSlice[]
  trendData: TrendPoint[]
  top5: string[]
  efficiencyData: EfficiencyBar[]
  sortedAgents: [string, { stats: { totalTokens: number; totalCost: number; requestCount: number } }][]
  formatCost: (cost: number) => string
  formatNumber: (num: number) => string
}

export function OverviewCharts({
  pieData,
  trendData,
  top5,
  efficiencyData,
  sortedAgents,
  formatCost,
  formatNumber,
}: OverviewChartsProps): JSX.Element {
  const maxCostPer1k = Math.max(...efficiencyData.map((d) => d.costPer1k), 0.0001)

  return (
    <div className="space-y-6">
      {/* Pie + Trend side-by-side */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Cost Distribution by Agent</h2>
          <div className="h-64">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No cost data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCost(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Cost Trends (Top 5 Agents)</h2>
          <div className="h-64">
            {trendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No trend data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCost(Number(value))} />
                  <Legend />
                  {top5.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Cost comparison bar */}
      {sortedAgents.length > 1 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Cost Comparison</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sortedAgents.slice(0, 10).map(([name, a]) => ({
                  name: name.length > 12 ? `${name.slice(0, 11)}\u2026` : name,
                  cost: Number(a.stats.totalCost.toFixed(4)),
                  tokens: a.stats.totalTokens,
                  requests: a.stats.requestCount,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, dataKey) =>
                    dataKey === 'cost' ? formatCost(Number(value)) : formatNumber(Number(value))
                  }
                />
                <Legend />
                <Bar dataKey="cost" fill={COLORS[0]} name="Cost ($)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Efficiency bars */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Cost Efficiency ($/1K Tokens per Agent)</h2>
        <div className="space-y-2">
          {efficiencyData.map(({ name, costPer1k }) => (
            <div key={name} className="flex items-center text-sm">
              <div className="w-32 truncate text-muted-foreground font-medium">{name}</div>
              <div className="flex-1 mx-3">
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${(costPer1k / maxCostPer1k) * 100}%` }}
                  />
                </div>
              </div>
              <div className="w-24 text-right text-xs text-muted-foreground">
                ${costPer1k.toFixed(4)}/1K
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
