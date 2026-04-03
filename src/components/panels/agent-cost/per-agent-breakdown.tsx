'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { ByAgentResponse } from './types'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

interface PerAgentBreakdownProps {
  data: ByAgentResponse | null
  formatCost: (cost: number) => string
  formatNumber: (num: number) => string
  onRefresh: () => void
}

export function PerAgentBreakdown({
  data,
  formatCost,
  formatNumber,
  onRefresh,
}: PerAgentBreakdownProps): JSX.Element {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  if (!data || data.agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">No per-agent data in database</div>
        <div className="text-sm">
          Token usage records will appear once agents start reporting heartbeats
        </div>
        <Button onClick={onRefresh} className="mt-4">Refresh</Button>
      </div>
    )
  }

  const { agents, summary } = data
  const maxCost = Math.max(...agents.map((a) => a.total_cost), 0.0001)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">Agents (DB)</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">Total Cost ({summary.days}d)</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">Total Tokens</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0
              ? `$${((summary.total_cost / summary.total_tokens) * 1000).toFixed(4)}`
              : '-'}
          </div>
          <div className="text-sm text-muted-foreground">Avg $/1K Tokens</div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Per-Agent Cost (Database)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={agents.slice(0, 12).map((a) => ({
                name: a.agent.length > 12 ? `${a.agent.slice(0, 11)}\u2026` : a.agent,
                cost: Number(a.total_cost.toFixed(4)),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => formatCost(Number(value))} />
              <Legend />
              <Bar dataKey="cost" fill={COLORS[0]} name="Cost ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expandable agent table */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Agent Token Breakdown</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map((agent) => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedRow === agent.agent
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button
                  onClick={() => setExpandedRow(isExpanded ? null : agent.agent)}
                  variant="ghost"
                  className="w-full p-4 h-auto flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-foreground truncate">{agent.agent}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {agent.session_count} session{agent.session_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      {agent.request_count} req{agent.request_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${(agent.total_cost / maxCost) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">tokens</div>
                    </div>
                    <svg
                      className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    >
                      <polyline points="4,6 8,10 12,6" />
                    </svg>
                  </div>
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 mb-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Input Tokens</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Output Tokens</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">I/O Ratio</div>
                        <div className="text-sm font-medium">
                          {agent.total_output_tokens > 0
                            ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2)
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Last Active</div>
                        <div className="text-sm font-medium">
                          {new Date(agent.last_active).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    {agent.models.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground font-medium mb-2">Model Breakdown</div>
                        <div className="space-y-1.5">
                          {agent.models.map((m) => {
                            const displayName = m.model.split('/').pop() ?? m.model
                            return (
                              <div key={m.model} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground truncate">{displayName}</span>
                                <div className="flex gap-4 shrink-0">
                                  <span>{formatNumber(m.input_tokens)} in</span>
                                  <span>{formatNumber(m.output_tokens)} out</span>
                                  <span>{m.request_count} reqs</span>
                                  <span className="font-medium text-foreground w-16 text-right">
                                    {formatCost(m.cost)}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
