'use client'

import { useState, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

export function SessionDetailsPanel() {
  const { 
    sessions, 
    selectedSession, 
    setSelectedSession,
    setSessions,
    availableModels 
  } = useMissionControl()

  // Smart polling for sessions (30s, visibility-aware)
  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions')
      const data = await response.json()
      setSessions(data.sessions || data)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }, [setSessions])

  useSmartPoll(loadSessions, 30000)

  const [sessionFilter, setSessionFilter] = useState<'all' | 'active' | 'idle'>('all')
  const [sortBy, setSortBy] = useState<'age' | 'tokens' | 'model'>('age')
  const [expandedSession, setExpandedSession] = useState<string | null>(null)

  const getModelInfo = (modelName: string) => {
    const modelAliases = availableModels.map(m => m.alias)
    const providerAliases = modelAliases.find(alias => modelName.toLowerCase().includes(alias.toLowerCase()))
    
    return availableModels.find(m => 
      m.name === modelName || 
      m.alias === modelName ||
      providerAliases
    ) || { alias: modelName, name: modelName, provider: 'unknown', description: 'Unknown model' }
  }

  const parseTokenUsage = (tokenString: string) => {
    // Parse token strings like "49k/35k (139%)" or "15k/35k (43%)"
    const match = tokenString.match(/(\d+(?:\.\d+)?)(k|m)?\/(\d+(?:\.\d+)?)(k|m)?\s*\((\d+(?:\.\d+)?)%\)/)
    if (!match) return { used: 0, total: 0, percentage: 0 }

    const used = parseFloat(match[1]) * (match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1)
    const total = parseFloat(match[3]) * (match[4] === 'k' ? 1000 : match[4] === 'm' ? 1000000 : 1)
    const percentage = parseFloat(match[5])

    return { used, total, percentage }
  }

  const getSessionTypeIcon = (sessionKey: string) => {
    if (sessionKey.includes(':main:main')) return '👑' // Main session
    if (sessionKey.includes(':subagent:')) return '🤖' // Sub-agent
    if (sessionKey.includes(':cron:')) return '⏰' // Cron job
    if (sessionKey.includes(':group:')) return '👥' // Group session
    return '💬' // Default
  }

  const getSessionType = (sessionKey: string) => {
    if (sessionKey.includes(':main:main')) return 'Main'
    if (sessionKey.includes(':subagent:')) return 'Sub-agent'
    if (sessionKey.includes(':cron:')) return 'Cron'
    if (sessionKey.includes(':group:')) return 'Group'
    return 'Unknown'
  }

  const getSessionStatus = (session: any) => {
    if (!session.active) return 'idle'
    const tokenUsage = parseTokenUsage(session.tokens)
    if (tokenUsage.percentage > 95) return 'critical'
    if (tokenUsage.percentage > 80) return 'warning'
    return 'active'
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400'
      case 'warning': return 'text-yellow-400'
      case 'critical': return 'text-red-400'
      case 'idle': return 'text-muted-foreground'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20'
      case 'warning': return 'bg-yellow-500/20'
      case 'critical': return 'bg-red-500/20'
      case 'idle': return 'bg-gray-500/20'
      default: return 'bg-secondary'
    }
  }

  const filteredSessions = sessions.filter(session => {
    switch (sessionFilter) {
      case 'active': return session.active
      case 'idle': return !session.active
      default: return true
    }
  })

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    switch (sortBy) {
      case 'tokens':
        const aUsage = parseTokenUsage(a.tokens)
        const bUsage = parseTokenUsage(b.tokens)
        return bUsage.percentage - aUsage.percentage
      case 'model':
        return a.model.localeCompare(b.model)
      case 'age':
      default:
        // Sort by age (newest first)
        if (a.age === 'just now') return -1
        if (b.age === 'just now') return 1
        return a.age.localeCompare(b.age)
    }
  })

  const handleSessionSelect = (session: any) => {
    setSelectedSession(session.id)
    setExpandedSession(expandedSession === session.id ? null : session.id)
  }

  const selectedSessionData = sessions.find(s => s.id === selectedSession)

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Session Management</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and manage active agent sessions
        </p>
      </div>

      {/* Filters and Controls */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex space-x-4">
            {/* Filter by Status */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Filter
              </label>
              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value as any)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All Sessions</option>
                <option value="active">Active Only</option>
                <option value="idle">Idle Only</option>
              </select>
            </div>

            {/* Sort by */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Sort by
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="age">Age</option>
                <option value="tokens">Token Usage</option>
                <option value="model">Model</option>
              </select>
            </div>
          </div>

          {/* Session Stats */}
          <div className="text-sm text-muted-foreground">
            {filteredSessions.length} of {sessions.length} sessions
            • {sessions.filter(s => s.active).length} active
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Sessions List */}
        <div className="lg:col-span-2 space-y-4">
          {sortedSessions.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-12 text-center">
              <div className="text-muted-foreground">
                No sessions match the current filter
              </div>
            </div>
          ) : (
            sortedSessions.map((session) => {
              const modelInfo = getModelInfo(session.model)
              const tokenUsage = parseTokenUsage(session.tokens)
              const status = getSessionStatus(session)
              const isExpanded = expandedSession === session.id

              return (
                <div 
                  key={session.id}
                  className={`bg-card border border-border rounded-lg p-6 cursor-pointer transition-all ${
                    selectedSession === session.id 
                      ? 'ring-2 ring-primary/50 border-primary/30' 
                      : 'hover:border-primary/20'
                  }`}
                  onClick={() => handleSessionSelect(session)}
                >
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3">
                          <span className="text-xl">{getSessionTypeIcon(session.key)}</span>
                          <div>
                            <h3 className="font-medium text-foreground truncate">
                              {session.key}
                            </h3>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <span>{getSessionType(session.key)}</span>
                              <span>•</span>
                              <span className={getStatusColor(status)}>
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                              </span>
                              <span>•</span>
                              <span>{session.age}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {session.flags.map((flag, index) => (
                          <span 
                            key={index}
                            className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded"
                          >
                            {flag}
                          </span>
                        ))}
                        <div className={`w-3 h-3 rounded-full ${
                          session.active ? 'bg-green-500' : 'bg-gray-500'
                        }`}></div>
                      </div>
                    </div>

                    {/* Model and Token Usage */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Model</div>
                        <div className="font-medium text-foreground">{modelInfo.alias}</div>
                        <div className="text-xs text-muted-foreground">{modelInfo.provider}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Token Usage</div>
                        <div className="font-medium text-foreground">{session.tokens}</div>
                        <div className="w-full bg-secondary rounded-full h-2 mt-1">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              tokenUsage.percentage > 95 ? 'bg-red-500' :
                              tokenUsage.percentage > 80 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(tokenUsage.percentage, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="pt-4 border-t border-border space-y-3">
                        <div>
                          <h4 className="font-medium text-foreground mb-2">Session Details</h4>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Kind:</span> 
                              <span className="ml-2 text-foreground">{session.kind}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">ID:</span> 
                              <span className="ml-2 text-foreground font-mono text-xs">{session.id}</span>
                            </div>
                            {session.lastActivity && (
                              <div>
                                <span className="text-muted-foreground">Last Activity:</span> 
                                <span className="ml-2 text-foreground">
                                  {new Date(session.lastActivity).toLocaleTimeString()}
                                </span>
                              </div>
                            )}
                            {session.messageCount && (
                              <div>
                                <span className="text-muted-foreground">Messages:</span> 
                                <span className="ml-2 text-foreground">{session.messageCount}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Model Information */}
                        <div>
                          <h4 className="font-medium text-foreground mb-2">Model Information</h4>
                          <div className="bg-secondary rounded p-3 text-sm">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-muted-foreground">Full Name:</span> 
                                <div className="font-mono text-xs text-foreground mt-1">{modelInfo.name}</div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Provider:</span> 
                                <div className="text-foreground mt-1">{modelInfo.provider}</div>
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Description:</span> 
                                <div className="text-foreground mt-1">{modelInfo.description}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex space-x-2">
                          <button
                            className="px-3 py-1 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              // TODO: Implement session monitoring
                              console.log('Monitor session:', session.id)
                            }}
                          >
                            Monitor
                          </button>
                          <button
                            className="px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              // TODO: Implement session pause
                              console.log('Pause session:', session.id)
                            }}
                          >
                            Pause
                          </button>
                          <button
                            className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm('Are you sure you want to terminate this session?')) {
                                // TODO: Implement session termination
                                console.log('Terminate session:', session.id)
                              }
                            }}
                          >
                            Terminate
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Session Summary */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Session Overview</h2>
            
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Sessions:</span>
                <span className="font-medium text-foreground">{sessions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active:</span>
                <span className="font-medium text-green-400">
                  {sessions.filter(s => s.active).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Idle:</span>
                <span className="font-medium text-muted-foreground">
                  {sessions.filter(s => !s.active).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sub-agents:</span>
                <span className="font-medium text-foreground">
                  {sessions.filter(s => s.key.includes(':subagent:')).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cron Jobs:</span>
                <span className="font-medium text-foreground">
                  {sessions.filter(s => s.key.includes(':cron:')).length}
                </span>
              </div>
            </div>
          </div>

          {/* Model Distribution */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Model Distribution</h2>
            
            <div className="space-y-3">
              {Object.entries(
                sessions.reduce((acc, session) => {
                  const model = getModelInfo(session.model).alias
                  acc[model] = (acc[model] || 0) + 1
                  return acc
                }, {} as Record<string, number>)
              ).map(([model, count]) => (
                <div key={model} className="flex items-center justify-between">
                  <span className="text-foreground">{model}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-muted-foreground">{count}</span>
                    <div className="w-16 bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{ width: `${(count / sessions.length) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* High Token Usage Alert */}
          {sessions.some(s => parseTokenUsage(s.tokens).percentage > 80) && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <h3 className="font-medium text-yellow-400 mb-2">⚠️ High Token Usage</h3>
              <div className="text-sm text-muted-foreground">
                {sessions.filter(s => parseTokenUsage(s.tokens).percentage > 80).length} sessions 
                are using more than 80% of their token limit.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}