'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { formatNumber, formatCost, getModelDisplayName } from './helpers'
import type { ByAgentEntry, ByAgentResponse, TaskCostEntry } from './types'

interface Props {
  agents: ByAgentEntry[]
  summary: ByAgentResponse['summary'] | undefined
  maxCost: number
  expandedAgent: string | null
  setExpandedAgent: (a: string | null) => void
  getAgentTasks: (name: string) => TaskCostEntry[]
  onRefresh: () => void
}

export function AgentsView({
  agents, summary, maxCost, expandedAgent, setExpandedAgent, getAgentTasks, onRefresh,
}: Props) {
  const t = useTranslations('costTracker')
  const [expandedSection, setExpandedSection] = useState<'models' | 'tasks'>('tasks')

  if (!summary || agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noAgentData')}</div>
        <div className="text-sm">{t('noAgentDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">{t('agents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCostDays', { days: summary.days })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0
              ? `$${(summary.total_cost / summary.total_tokens * 1000).toFixed(4)}`
              : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('avgPer1kTokens')}</div>
        </div>
      </div>

      {/* Cost bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('perAgentCost')}</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agents.slice(0, 12).map(a => ({
              name: a.agent.length > 12 ? a.agent.slice(0, 11) + '\u2026' : a.agent,
              cost: Number(a.total_cost.toFixed(4)),
            }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCost(Number(v))} />
              <Bar dataKey="cost" fill="#0088FE" name="Cost ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent detail rows */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('agentBreakdown')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map(agent => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedAgent === agent.agent
            const agentTasks = getAgentTasks(agent.agent)
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button
                  onClick={() => setExpandedAgent(isExpanded ? null : agent.agent)}
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
                    {agentTasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 shrink-0">
                        {agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(agent.total_cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">{t('tokens')}</div>
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
                        <div className="text-xs text-muted-foreground">{t('inputTokens')}</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('outputTokens')}</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('ioRatio')}</div>
                        <div className="text-sm font-medium">
                          {agent.total_output_tokens > 0
                            ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2)
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('lastActive')}</div>
                        <div className="text-sm font-medium">{new Date(agent.last_active).toLocaleDateString()}</div>
                      </div>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <Button
                        variant={expandedSection === 'tasks' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setExpandedSection('tasks') }}
                      >
                        Tasks ({agentTasks.length})
                      </Button>
                      <Button
                        variant={expandedSection === 'models' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setExpandedSection('models') }}
                      >
                        Models ({agent.models.length})
                      </Button>
                    </div>

                    {expandedSection === 'tasks' && (
                      <div className="text-sm">
                        {agentTasks.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic py-2">{t('noTaskCosts')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {agentTasks.map(task => (
                              <div key={task.taskId} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                                    'bg-secondary text-muted-foreground'
                                  }`}>{task.priority}</span>
                                  {task.project.ticketRef && (
                                    <span className="text-muted-foreground font-mono">{task.project.ticketRef}</span>
                                  )}
                                  <span className="text-foreground truncate">{task.title}</span>
                                </div>
                                <span className="font-medium text-foreground w-16 text-right shrink-0">
                                  {formatCost(task.stats.totalCost)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedSection === 'models' && agent.models.length > 0 && (
                      <div className="space-y-1.5">
                        {agent.models.map(m => (
                          <div key={m.model} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate">{getModelDisplayName(m.model)}</span>
                            <div className="flex gap-4 shrink-0">
                              <span>{formatNumber(m.input_tokens)} in</span>
                              <span>{formatNumber(m.output_tokens)} out</span>
                              <span>{m.request_count} reqs</span>
                              <span className="font-medium text-foreground w-16 text-right">{formatCost(m.cost)}</span>
                            </div>
                          </div>
                        ))}
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
