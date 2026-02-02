'use client'

import { useState, useEffect } from 'react'

interface StandupReport {
  date: string
  generatedAt: string
  summary: {
    totalAgents: number
    totalCompleted: number
    totalInProgress: number
    totalAssigned: number
    totalReview: number
    totalBlocked: number
    totalActivity: number
    overdue: number
  }
  agentReports: Array<{
    agent: {
      name: string
      role: string
      status: string
      last_seen?: number
      last_activity?: string
    }
    completedToday: Array<{
      id: number
      title: string
      status: string
      updated_at: number
    }>
    inProgress: Array<{
      id: number
      title: string
      status: string
      created_at: number
      due_date?: number
    }>
    assigned: Array<{
      id: number
      title: string
      status: string
      created_at: number
      due_date?: number
      priority: string
    }>
    review: Array<{
      id: number
      title: string
      status: string
      updated_at: number
    }>
    blocked: Array<{
      id: number
      title: string
      status: string
      priority: string
      created_at: number
      metadata?: any
    }>
    activity: {
      actionCount: number
      commentsCount: number
    }
  }>
  teamAccomplishments: Array<{
    id: number
    title: string
    agent: string
    updated_at: number
  }>
  teamBlockers: Array<{
    id: number
    title: string
    priority: string
    agent: string
    created_at: number
  }>
  overdueTasks: Array<{
    id: number
    title: string
    due_date: number
    status: string
    agent_name?: string
  }>
}

interface StandupHistory {
  id: number
  date: string
  generatedAt: string
  summary: any
  agentCount: number
}

export function StandupPanel() {
  const [standupReport, setStandupReport] = useState<StandupReport | null>(null)
  const [standupHistory, setStandupHistory] = useState<StandupHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [view, setView] = useState<'current' | 'history'>('current')

  // Generate standup report
  const generateStandup = async (date?: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/standup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: date || selectedDate })
      })

      if (!response.ok) throw new Error('Failed to generate standup')

      const data = await response.json()
      setStandupReport(data.standup)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Fetch standup history
  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/standup/history')
      if (!response.ok) throw new Error('Failed to fetch history')

      const data = await response.json()
      setStandupHistory(data.history || [])
    } catch (err) {
      console.error('Failed to fetch standup history:', err)
    }
  }

  useEffect(() => {
    if (view === 'history') {
      fetchHistory()
    }
  }, [view])

  // Format date for display
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  // Format time for display
  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Get priority color
  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'text-green-400',
      medium: 'text-yellow-400',
      high: 'text-orange-400',
      urgent: 'text-red-400'
    }
    return colors[priority] || 'text-gray-400'
  }

  // Export standup as text
  const exportStandup = () => {
    if (!standupReport) return

    const lines = [
      `# Daily Standup - ${formatDate(standupReport.date)}`,
      `Generated: ${new Date(standupReport.generatedAt).toLocaleString()}`,
      '',
      '## Summary',
      `- **Agents Active:** ${standupReport.summary.totalAgents}`,
      `- **Completed Today:** ${standupReport.summary.totalCompleted}`,
      `- **In Progress:** ${standupReport.summary.totalInProgress}`,
      `- **Assigned:** ${standupReport.summary.totalAssigned}`,
      `- **In Review:** ${standupReport.summary.totalReview}`,
      `- **Blocked:** ${standupReport.summary.totalBlocked}`,
      `- **Overdue:** ${standupReport.summary.overdue}`,
      '',
    ]

    // Add team accomplishments
    if (standupReport.teamAccomplishments.length > 0) {
      lines.push('## Team Accomplishments')
      standupReport.teamAccomplishments.forEach(task => {
        lines.push(`- **${task.agent}**: ${task.title}`)
      })
      lines.push('')
    }

    // Add team blockers
    if (standupReport.teamBlockers.length > 0) {
      lines.push('## Team Blockers')
      standupReport.teamBlockers.forEach(task => {
        lines.push(`- **${task.agent}** [${task.priority.toUpperCase()}]: ${task.title}`)
      })
      lines.push('')
    }

    // Add individual agent reports
    lines.push('## Individual Reports')
    standupReport.agentReports.forEach(report => {
      lines.push(`### ${report.agent.name} (${report.agent.role})`)
      
      if (report.completedToday.length > 0) {
        lines.push('**Completed Today:**')
        report.completedToday.forEach(task => {
          lines.push(`- ${task.title}`)
        })
      }
      
      if (report.inProgress.length > 0) {
        lines.push('**In Progress:**')
        report.inProgress.forEach(task => {
          lines.push(`- ${task.title}`)
        })
      }
      
      if (report.blocked.length > 0) {
        lines.push('**Blocked:**')
        report.blocked.forEach(task => {
          lines.push(`- [${task.priority.toUpperCase()}] ${task.title}`)
        })
      }
      
      lines.push('')
    })

    const text = lines.join('\n')
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `standup-${standupReport.date}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Daily Standup</h2>
        
        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setView('current')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                view === 'current' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Current
            </button>
            <button
              onClick={() => setView('history')}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                view === 'history' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              History
            </button>
          </div>

          {view === 'current' && (
            <>
              {/* Date Picker */}
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Actions */}
              <button
                onClick={() => generateStandup()}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>}
                {loading ? 'Generating...' : 'Generate Standup'}
              </button>

              {standupReport && (
                <button
                  onClick={exportStandup}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  Export
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'current' ? (
          // Current Standup View
          standupReport ? (
            <div className="p-4 space-y-6">
              {/* Report Header */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Standup for {formatDate(standupReport.date)}
                </h3>
                <p className="text-gray-400 text-sm">
                  Generated on {new Date(standupReport.generatedAt).toLocaleString()}
                </p>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-white">{standupReport.summary.totalCompleted}</div>
                  <div className="text-sm text-green-400">Completed</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-white">{standupReport.summary.totalInProgress}</div>
                  <div className="text-sm text-yellow-400">In Progress</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-white">{standupReport.summary.totalBlocked}</div>
                  <div className="text-sm text-red-400">Blocked</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-white">{standupReport.summary.overdue}</div>
                  <div className="text-sm text-orange-400">Overdue</div>
                </div>
              </div>

              {/* Team Accomplishments */}
              {standupReport.teamAccomplishments.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-white mb-3">🎉 Team Accomplishments</h4>
                  <div className="space-y-2">
                    {standupReport.teamAccomplishments.map(task => (
                      <div key={task.id} className="flex justify-between items-center p-2 bg-green-900/20 rounded border-l-4 border-green-500">
                        <span className="text-white">{task.title}</span>
                        <span className="text-green-400 text-sm">{task.agent}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Blockers */}
              {standupReport.teamBlockers.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-white mb-3">🚫 Team Blockers</h4>
                  <div className="space-y-2">
                    {standupReport.teamBlockers.map(task => (
                      <div key={task.id} className="flex justify-between items-center p-2 bg-red-900/20 rounded border-l-4 border-red-500">
                        <div>
                          <span className="text-white">{task.title}</span>
                          <span className={`ml-2 text-sm ${getPriorityColor(task.priority)}`}>
                            [{task.priority.toUpperCase()}]
                          </span>
                        </div>
                        <span className="text-red-400 text-sm">{task.agent}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Overdue Tasks */}
              {standupReport.overdueTasks.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-white mb-3">⏰ Overdue Tasks</h4>
                  <div className="space-y-2">
                    {standupReport.overdueTasks.map(task => (
                      <div key={task.id} className="flex justify-between items-center p-2 bg-orange-900/20 rounded border-l-4 border-orange-500">
                        <div>
                          <span className="text-white">{task.title}</span>
                          <span className="text-orange-400 text-sm ml-2">
                            (Due: {new Date(task.due_date * 1000).toLocaleDateString()})
                          </span>
                        </div>
                        <span className="text-orange-400 text-sm">{task.agent_name || 'Unassigned'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Individual Agent Reports */}
              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-white">👥 Individual Reports</h4>
                {standupReport.agentReports.map(report => (
                  <div key={report.agent.name} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h5 className="font-semibold text-white">{report.agent.name}</h5>
                        <p className="text-gray-400 text-sm">{report.agent.role}</p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-gray-400">Activity: {report.activity.actionCount} actions, {report.activity.commentsCount} comments</div>
                        {report.agent.last_activity && (
                          <div className="text-gray-500">{report.agent.last_activity}</div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Completed Today */}
                      <div>
                        <h6 className="text-green-400 font-medium mb-2">✅ Completed ({report.completedToday.length})</h6>
                        <div className="space-y-1">
                          {report.completedToday.map(task => (
                            <div key={task.id} className="text-sm text-gray-300 truncate" title={task.title}>
                              {task.title}
                            </div>
                          ))}
                          {report.completedToday.length === 0 && (
                            <div className="text-sm text-gray-500 italic">None</div>
                          )}
                        </div>
                      </div>

                      {/* In Progress */}
                      <div>
                        <h6 className="text-yellow-400 font-medium mb-2">🔄 In Progress ({report.inProgress.length})</h6>
                        <div className="space-y-1">
                          {report.inProgress.map(task => (
                            <div key={task.id} className="text-sm text-gray-300 truncate" title={task.title}>
                              {task.title}
                            </div>
                          ))}
                          {report.inProgress.length === 0 && (
                            <div className="text-sm text-gray-500 italic">None</div>
                          )}
                        </div>
                      </div>

                      {/* Assigned */}
                      <div>
                        <h6 className="text-blue-400 font-medium mb-2">📋 Assigned ({report.assigned.length})</h6>
                        <div className="space-y-1">
                          {report.assigned.map(task => (
                            <div key={task.id} className="text-sm text-gray-300">
                              <div className="truncate" title={task.title}>{task.title}</div>
                              <div className={`text-xs ${getPriorityColor(task.priority)}`}>
                                [{task.priority}]
                              </div>
                            </div>
                          ))}
                          {report.assigned.length === 0 && (
                            <div className="text-sm text-gray-500 italic">None</div>
                          )}
                        </div>
                      </div>

                      {/* Blocked */}
                      <div>
                        <h6 className="text-red-400 font-medium mb-2">🚫 Blocked ({report.blocked.length})</h6>
                        <div className="space-y-1">
                          {report.blocked.map(task => (
                            <div key={task.id} className="text-sm text-gray-300">
                              <div className="truncate" title={task.title}>{task.title}</div>
                              <div className={`text-xs ${getPriorityColor(task.priority)}`}>
                                [{task.priority}]
                              </div>
                            </div>
                          ))}
                          {report.blocked.length === 0 && (
                            <div className="text-sm text-gray-500 italic">None</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Empty state for current view
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">📊</div>
              <h3 className="text-xl font-semibold text-white mb-2">No Standup Generated</h3>
              <p className="text-gray-400 mb-6">Select a date and generate a standup report to get started</p>
              <button
                onClick={() => generateStandup()}
                disabled={loading}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Generate Today's Standup
              </button>
            </div>
          )
        ) : (
          // History View
          <div className="p-4">
            {standupHistory.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <div className="text-4xl mb-2">📚</div>
                <p>No standup history found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {standupHistory.map(history => (
                  <div key={history.id} className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-white font-medium">{formatDate(history.date)}</h4>
                        <p className="text-gray-400 text-sm">
                          Generated: {new Date(history.generatedAt).toLocaleString()}
                        </p>
                        <p className="text-gray-400 text-sm">
                          {history.agentCount} agents participated
                        </p>
                      </div>
                      <div className="text-right">
                        {history.summary && (
                          <div className="text-sm text-gray-400">
                            <div>Completed: {history.summary.completed || 0}</div>
                            <div>In Progress: {history.summary.inProgress || 0}</div>
                            <div>Blocked: {history.summary.blocked || 0}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}