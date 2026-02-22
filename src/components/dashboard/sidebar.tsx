'use client'

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'

interface MenuItem {
  id: string
  label: string
  icon: string
  description?: string
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Overview', icon: '📊', description: 'System dashboard' },
  { id: 'sessions', label: 'Sessions', icon: '💬', description: 'Active agent sessions' },
  { id: 'tasks', label: 'Task Board', icon: '📋', description: 'Kanban task management' },
  { id: 'agents', label: 'Agent Squad', icon: '🤖', description: 'Agent management & status' },
  { id: 'activity', label: 'Activity Feed', icon: '📣', description: 'Real-time activity stream' },
  { id: 'notifications', label: 'Notifications', icon: '🔔', description: 'Mentions & alerts' },
  { id: 'standup', label: 'Daily Standup', icon: '📈', description: 'Generate standup reports' },
  { id: 'spawn', label: 'Spawn Agent', icon: '🚀', description: 'Launch new sub-agents' },
  { id: 'logs', label: 'Logs', icon: '📝', description: 'Real-time log viewer' },
  { id: 'cron', label: 'Cron Jobs', icon: '⏰', description: 'Automated tasks' },
  { id: 'memory', label: 'Memory', icon: '🧠', description: 'Knowledge browser' },
  { id: 'tokens', label: 'Tokens', icon: '💰', description: 'Usage & cost tracking' },
]

export function Sidebar() {
  const { activeTab, setActiveTab, connection, sessions } = useMissionControl()
  const [systemStats, setSystemStats] = useState<any>(null)

  useEffect(() => {
    // Fetch system status
    fetch('/api/status?action=overview')
      .then(res => res.json())
      .then(data => setSystemStats(data))
      .catch(err => console.error('Failed to fetch system status:', err))
  }, [])

  const activeSessions = sessions.filter(s => s.active).length
  const totalSessions = sessions.length

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">MC</span>
          </div>
          <div>
            <h2 className="font-bold text-foreground">Mission Control</h2>
            <p className="text-xs text-muted-foreground">ClawdBot Orchestration</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-start space-x-3 px-3 py-3 rounded-lg text-left transition-colors group ${
                  activeTab === item.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title={item.description}
              >
                <span className="text-lg mt-0.5">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className={`text-xs mt-0.5 ${
                    activeTab === item.id 
                      ? 'text-primary-foreground/80' 
                      : 'text-muted-foreground group-hover:text-foreground/70'
                  }`}>
                    {item.description}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Status Footer */}
      <div className="p-4 border-t border-border space-y-3">
        {/* Connection Status */}
        <div className="bg-secondary rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Gateway</span>
            <div className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                connection.isConnected 
                  ? 'bg-green-500 animate-pulse' 
                  : 'bg-red-500'
              }`}></div>
              <span className="text-xs text-muted-foreground">
                {connection.isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
            <div className="mt-2 space-y-1">
              <div className="text-xs text-muted-foreground">
                {connection.url || 'ws://<gateway-host>:<gateway-port>'}
              </div>
              {connection.latency && (
                <div className="text-xs text-muted-foreground">
                  Latency: {connection.latency}ms
                </div>
            )}
          </div>
        </div>

        {/* Session Stats */}
        <div className="bg-secondary rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Sessions</span>
            <span className="text-xs text-muted-foreground">
              {activeSessions}/{totalSessions}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {activeSessions} active • {totalSessions - activeSessions} idle
          </div>
        </div>

        {/* System Stats */}
        {systemStats && (
          <div className="bg-secondary rounded-lg p-3">
            <div className="text-sm font-medium text-foreground mb-2">System</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Memory:</span>
                <span>{systemStats.memory ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100) : 0}%</span>
              </div>
              <div className="flex justify-between">
                <span>Disk:</span>
                <span>{systemStats.disk.usage || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span>Processes:</span>
                <span>{systemStats.processes?.length || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
