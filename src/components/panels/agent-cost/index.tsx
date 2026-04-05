'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useAgentCost } from './use-agent-cost'
import { PerAgentBreakdown } from './per-agent-breakdown'
import { OverviewCharts } from './overview-charts'
import { AgentRankingTable } from './agent-ranking-table'

export function AgentCostPanel(): JSX.Element {
  const state = useAgentCost()

  const summaryCards = (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-3xl font-bold text-foreground">{state.agents.length}</div>
        <div className="text-sm text-muted-foreground">Active Agents</div>
      </div>
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-3xl font-bold text-foreground">{state.formatCost(state.totalCost)}</div>
        <div className="text-sm text-muted-foreground">Total Cost ({state.selectedTimeframe})</div>
      </div>
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-3xl font-bold text-orange-500 truncate">
          {state.mostExpensive?.[0] ?? '-'}
        </div>
        <div className="text-sm text-muted-foreground">Most Expensive</div>
        {state.mostExpensive && (
          <div className="text-xs text-muted-foreground mt-1">
            {state.formatCost(state.mostExpensive[1].stats.totalCost)} (
            {((state.mostExpensive[1].stats.totalCost / Math.max(state.totalCost, 0.0001)) * 100).toFixed(0)}%)
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-3xl font-bold text-green-500 truncate">
          {state.mostEfficient?.[0] ?? '-'}
        </div>
        <div className="text-sm text-muted-foreground">Most Efficient</div>
        {state.mostEfficient && (
          <div className="text-xs text-muted-foreground mt-1">
            ${(
              (state.mostEfficient[1].stats.totalCost /
                Math.max(1, state.mostEfficient[1].stats.totalTokens)) *
              1000
            ).toFixed(4)}/1K tokens
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-3xl font-bold text-foreground">
          {state.taskData
            ? `${(
                (1 -
                  state.taskData.unattributed.totalCost /
                    Math.max(state.totalCost, 0.0001)) *
                100
              ).toFixed(0)}%`
            : '-'}
        </div>
        <div className="text-sm text-muted-foreground">Task-Attributed</div>
        {state.taskData && state.taskData.unattributed.totalCost > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            {state.formatCost(state.taskData.unattributed.totalCost)} unattributed
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Agent Cost Breakdown</h1>
            <p className="text-muted-foreground mt-2">Per-agent token usage and spend analysis</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex space-x-1 bg-secondary rounded-lg p-1">
              <Button
                onClick={() => state.setActiveView('overview')}
                variant={state.activeView === 'overview' ? 'default' : 'ghost'}
                size="sm"
              >
                Overview
              </Button>
              <Button
                onClick={() => state.setActiveView('per-agent')}
                variant={state.activeView === 'per-agent' ? 'default' : 'ghost'}
                size="sm"
              >
                Per-Agent DB
              </Button>
            </div>
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map((tf) => (
                <Button
                  key={tf}
                  onClick={() => state.setSelectedTimeframe(tf)}
                  variant={state.selectedTimeframe === tf ? 'default' : 'secondary'}
                >
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {state.error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{state.error}</span>
          <button
            onClick={() => { state.clearError(); void state.loadData() }}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {state.isLoading ? (
        <Loader variant="panel" label="Loading agent costs" />
      ) : state.activeView === 'per-agent' ? (
        <PerAgentBreakdown
          data={state.byAgentData}
          formatCost={state.formatCost}
          formatNumber={state.formatNumber}
          onRefresh={state.loadData}
        />
      ) : !state.data || state.agents.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">No agent cost data available</div>
          <div className="text-sm">Cost data will appear once agents start using tokens</div>
          <Button onClick={state.loadData} className="mt-4">Refresh</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {summaryCards}
          <OverviewCharts
            pieData={state.pieData}
            trendData={state.trendData}
            top5={state.top5}
            efficiencyData={state.efficiencyData}
            sortedAgents={state.sortedAgents}
            formatCost={state.formatCost}
            formatNumber={state.formatNumber}
          />
          <AgentRankingTable
            sortedAgents={state.sortedAgents}
            totalCost={state.totalCost}
            expandedAgent={state.expandedAgent}
            expandedSection={state.expandedSection}
            onExpandAgent={state.setExpandedAgent}
            onExpandSection={state.setExpandedSection}
            getAgentTasks={state.getAgentTasks}
            formatCost={state.formatCost}
            formatNumber={state.formatNumber}
          />
        </div>
      )}
    </div>
  )
}
