'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import type { AgentCostData, TaskCostEntry, ExpandedSection } from './types'

interface AgentRankingTableProps {
  sortedAgents: [string, AgentCostData][]
  totalCost: number
  expandedAgent: string | null
  expandedSection: ExpandedSection
  onExpandAgent: (name: string | null) => void
  onExpandSection: (section: ExpandedSection) => void
  getAgentTasks: (name: string) => TaskCostEntry[]
  formatCost: (cost: number) => string
  formatNumber: (num: number) => string
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-500',
  high: 'bg-orange-500/10 text-orange-500',
  medium: 'bg-yellow-500/10 text-yellow-500',
}

const STATUS_BADGE: Record<string, string> = {
  done: 'bg-green-500/10 text-green-500',
  in_progress: 'bg-blue-500/10 text-blue-500',
}

export function AgentRankingTable({
  sortedAgents,
  totalCost,
  expandedAgent,
  expandedSection,
  onExpandAgent,
  onExpandSection,
  getAgentTasks,
  formatCost,
  formatNumber,
}: AgentRankingTableProps): JSX.Element {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Agent Cost Ranking</h2>
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {sortedAgents.map(([name, a], index) => {
          const costShare = (a.stats.totalCost / Math.max(totalCost, 0.0001)) * 100
          const agentTasks = getAgentTasks(name)
          const isExpanded = expandedAgent === name

          return (
            <div key={name} className="border border-border rounded-lg overflow-hidden">
              <Button
                onClick={() => onExpandAgent(isExpanded ? null : name)}
                variant="ghost"
                className="w-full p-4 h-auto flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-6">#{index + 1}</span>
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {a.sessions.length} session{a.sessions.length !== 1 ? 's' : ''}
                  </span>
                  {agentTasks.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
                      {agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="font-medium text-foreground">{formatCost(a.stats.totalCost)}</div>
                    <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}% of total</div>
                  </div>
                  <div className="text-right">
                    <div className="text-muted-foreground">{formatNumber(a.stats.totalTokens)} tokens</div>
                    <div className="text-xs text-muted-foreground">{a.stats.requestCount} reqs</div>
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
                  <div className="flex gap-2 pt-3 mb-3">
                    <Button
                      variant={expandedSection === 'tasks' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onExpandSection('tasks') }}
                    >
                      Tasks ({agentTasks.length})
                    </Button>
                    <Button
                      variant={expandedSection === 'models' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onExpandSection('models') }}
                    >
                      Models ({Object.keys(a.models).length})
                    </Button>
                  </div>

                  {expandedSection === 'tasks' && (
                    <div className="text-sm">
                      {agentTasks.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic py-2">
                          No task-attributed costs for this agent
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {agentTasks.map((task) => {
                            const taskShare =
                              (task.stats.totalCost / Math.max(a.stats.totalCost, 0.0001)) * 100
                            return (
                              <div key={task.taskId} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    PRIORITY_BADGE[task.priority] ?? 'bg-secondary text-muted-foreground'
                                  }`}>
                                    {task.priority}
                                  </span>
                                  {task.project.ticketRef && (
                                    <span className="text-muted-foreground font-mono">
                                      {task.project.ticketRef}
                                    </span>
                                  )}
                                  <span className="text-foreground truncate">{task.title}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    STATUS_BADGE[task.status] ?? 'bg-secondary text-muted-foreground'
                                  }`}>
                                    {task.status}
                                  </span>
                                </div>
                                <div className="flex gap-3 ml-2 shrink-0">
                                  <span className="text-muted-foreground">{taskShare.toFixed(0)}%</span>
                                  <span className="font-medium text-foreground w-16 text-right">
                                    {formatCost(task.stats.totalCost)}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {expandedSection === 'models' && (
                    <div className="text-sm">
                      <div className="space-y-1.5">
                        {Object.entries(a.models)
                          .sort(([, x], [, y]) => y.totalCost - x.totalCost)
                          .map(([model, stats]) => {
                            const displayName = model.split('/').pop() ?? model
                            return (
                              <div key={model} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{displayName}</span>
                                <div className="flex gap-4">
                                  <span>{formatNumber(stats.totalTokens)} tokens</span>
                                  <span>{stats.requestCount} reqs</span>
                                  <span className="font-medium text-foreground">
                                    {formatCost(stats.totalCost)}
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
  )
}
