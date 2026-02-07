'use client'

import { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'
import { StatsGrid } from './stats-grid'
import { SessionsList } from './sessions-list'
import { AgentNetwork } from './agent-network'

export function Dashboard() {
  const { 
    sessions, 
    setSessions,
    connection, 
    lastMessage, 
    logs,
    spawnRequests,
    cronJobs,
    availableModels
  } = useMissionControl()

  const [systemStats, setSystemStats] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Load system status
    loadSystemStats()
    
    // Load sessions
    loadSessions()
    
    // Set up periodic refresh
    const statInterval = setInterval(loadSystemStats, 30000) // Every 30 seconds
    const sessionsInterval = setInterval(loadSessions, 30000) // Every 30 seconds
    
    return () => {
      clearInterval(statInterval)
      clearInterval(sessionsInterval)
    }
  }, [])

  const loadSystemStats = async () => {
    try {
      const response = await fetch('/api/status?action=overview')
      if (!response.ok) {
        console.warn('Status API returned', response.status)
        return
      }
      const data = await response.json()
      if (data && !data.error) {
        setSystemStats(data)
      }
    } catch (error) {
      console.error('Failed to load system stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions')
      if (!response.ok) {
        console.warn('Sessions API returned', response.status)
        return
      }
      const data = await response.json()
      if (data && !data.error) {
        setSessions(data.sessions || data)
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  // Calculate dashboard stats
  const stats = {
    totalSessions: sessions.length,
    activeSessions: sessions.filter(s => s.active).length,
    totalMessages: logs.length,
    uptime: systemStats?.uptime || 0,
    errors: logs.filter(log => log.level === 'error').length
  }

  // Get recent activity
  const recentLogs = logs.slice(0, 5)
  const recentSpawns = spawnRequests.slice(0, 3)

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Mission Control Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Real-time overview of ClawdBot agent orchestration system
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-3 text-muted-foreground">Loading dashboard...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stats Overview */}
          <div className="grid gap-6">
            <StatsGrid stats={stats} systemStats={systemStats} />
          </div>

          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Sessions List */}
            <div className="lg:col-span-1">
              <SessionsList sessions={sessions.slice(0, 10)} />
            </div>

            {/* Agent Network Visualization */}
            <div className="lg:col-span-1">
              <AgentNetwork agents={[]} sessions={sessions} />
            </div>

            {/* Recent Activity */}
            <div className="lg:col-span-1 space-y-6">
              {/* Recent Logs */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                
                <div className="space-y-3">
                  {recentLogs.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4">
                      No recent activity
                    </div>
                  ) : (
                    recentLogs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3">
                        <div className={`w-2 h-2 rounded-full mt-2 ${
                          log.level === 'error' ? 'bg-red-500' :
                          log.level === 'warn' ? 'bg-yellow-500' :
                          log.level === 'info' ? 'bg-blue-500' : 'bg-gray-500'
                        }`}></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground">
                            {log.message.substring(0, 60)}
                            {log.message.length > 60 && '...'}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center space-x-2">
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span>•</span>
                            <span>{log.source}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent Spawns */}
              {recentSpawns.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Recent Spawns</h2>
                  
                  <div className="space-y-3">
                    {recentSpawns.map((spawn) => (
                      <div key={spawn.id} className="flex items-start space-x-3">
                        <div className={`w-2 h-2 rounded-full mt-2 ${
                          spawn.status === 'completed' ? 'bg-green-500' :
                          spawn.status === 'running' ? 'bg-blue-500' :
                          spawn.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                        }`}></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground font-medium">
                            {spawn.label}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {spawn.model} • {spawn.status}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(spawn.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* System Health */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">System Health</h2>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Gateway</span>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${
                        connection.isConnected ? 'bg-green-500' : 'bg-red-500'
                      }`}></div>
                      <span className="text-sm text-foreground">
                        {connection.isConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                  </div>

                  {systemStats && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Memory</span>
                        <span className="text-sm text-foreground">
                          {systemStats?.memory ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100) : 0}%
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Disk</span>
                        <span className="text-sm text-foreground">
                          {systemStats?.disk?.usage || 'N/A'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Uptime</span>
                        <span className="text-sm text-foreground">
                          {systemStats?.uptime ? Math.floor(systemStats.uptime / (1000 * 60 * 60)) : 0}h
                        </span>
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Errors (24h)</span>
                    <span className={`text-sm ${stats.errors > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {stats.errors}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                onClick={() => window.location.hash = '#spawn'}
                className="p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="text-2xl mb-2">🚀</div>
                <div className="font-medium text-foreground">Spawn Agent</div>
                <div className="text-sm text-muted-foreground">Launch new sub-agent</div>
              </button>

              <button
                onClick={() => window.location.hash = '#logs'}
                className="p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="text-2xl mb-2">📝</div>
                <div className="font-medium text-foreground">View Logs</div>
                <div className="text-sm text-muted-foreground">Real-time log viewer</div>
              </button>

              <button
                onClick={() => window.location.hash = '#cron'}
                className="p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="text-2xl mb-2">⏰</div>
                <div className="font-medium text-foreground">Cron Jobs</div>
                <div className="text-sm text-muted-foreground">Manage automation</div>
              </button>

              <button
                onClick={() => window.location.hash = '#memory'}
                className="p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-primary/5 transition-colors text-left"
              >
                <div className="text-2xl mb-2">🧠</div>
                <div className="font-medium text-foreground">Memory</div>
                <div className="text-sm text-muted-foreground">Browse knowledge</div>
              </button>
            </div>
          </div>

          {/* Debug Info */}
          {lastMessage && (
            <div className="mt-8">
              <details className="bg-card p-4 rounded-lg border">
                <summary className="cursor-pointer font-medium text-sm text-muted-foreground">
                  Last WebSocket Message (Debug)
                </summary>
                <pre className="mt-2 text-xs text-muted-foreground overflow-auto">
                  {JSON.stringify(lastMessage, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  )
}