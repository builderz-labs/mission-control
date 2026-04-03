'use client'

import type { JSX } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'
import type { UsageStats, TrendData, TimezoneOption } from './types'
import { CHART_COLORS, PROVIDER_COLORS } from './constants'
import {
  prepareModelChartData,
  preparePieChartData,
  prepareProviderPieData,
  prepareTrendChartData,
} from './chart-helpers'
import { formatNumber, formatCost } from './formatters'

interface ChartsProps {
  readonly filteredUsageStats: UsageStats
  readonly trendData: TrendData | null
  readonly chartMode: 'incremental' | 'cumulative'
  readonly selectedTimeframe: string
  readonly peakTrendHour: string | null
  readonly selectedTimezone: TimezoneOption
  readonly onChartModeChange: (mode: 'incremental' | 'cumulative') => void
}

export function ChartsSection({
  filteredUsageStats,
  trendData,
  chartMode,
  selectedTimeframe,
  peakTrendHour,
  selectedTimezone,
  onChartModeChange,
}: ChartsProps): JSX.Element {
  const trendChartData = prepareTrendChartData(trendData, chartMode, selectedTimezone)
  const modelChartData = prepareModelChartData(filteredUsageStats.models)
  const pieChartData = preparePieChartData(filteredUsageStats.models)
  const providerPieData = prepareProviderPieData(filteredUsageStats.models)

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Usage Trends */}
      <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Usage Trends ({selectedTimeframe})</h2>
          <div className="flex items-center gap-3">
            {peakTrendHour && (
              <span className="text-xs text-muted-foreground">
                Peak: <span className="text-foreground font-medium">{peakTrendHour}</span>
              </span>
            )}
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => onChartModeChange('incremental')}
                className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'incremental' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Per-Turn
              </button>
              <button
                onClick={() => onChartModeChange('cumulative')}
                className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'cumulative' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Cumulative
              </button>
            </div>
          </div>
        </div>
        <div className="h-64">
          {trendChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No trend data for this timeframe
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="tokens" stroke="#8884d8" strokeWidth={2} name="Tokens" />
                <Line type="monotone" dataKey="requests" stroke="#82ca9d" strokeWidth={2} name="Requests" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Model Usage Bar Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Token Usage by Model</h2>
        <div className="h-64">
          {modelChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No model usage data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                <YAxis />
                <Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} />
                <Bar dataKey="tokens" fill="#8884d8" name="Tokens" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cost Distribution Pie */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Cost Distribution by Model</h2>
        <div className="h-64">
          {pieChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No cost data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieChartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCost(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cost by Provider */}
      <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
        <h2 className="text-xl font-semibold mb-4">Cost by Provider</h2>
        <div className="h-64">
          {providerPieData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No provider data yet
            </div>
          ) : (
            <div className="flex h-full">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={providerPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {providerPieData.map(entry => (
                        <Cell
                          key={entry.name}
                          fill={PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCost(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-48 flex flex-col justify-center space-y-2">
                {providerPieData.map(entry => (
                  <div key={entry.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other }}
                      />
                      <span className="text-muted-foreground">{entry.name}</span>
                    </div>
                    <span className="text-foreground font-medium">{formatCost(entry.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
