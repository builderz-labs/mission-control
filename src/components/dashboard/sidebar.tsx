'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { createClientLogger } from '@/lib/client-logger'
import { Button } from '@/components/ui/button'

const log = createClientLogger('Sidebar')

type SystemStats = {
  memory?: {
    used: number
    total: number
  }
  disk?: {
    usage?: string
  }
  processes?: unknown[]
}

function readSystemStats(value: unknown): SystemStats | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const memory = record.memory && typeof record.memory === 'object' ? record.memory as Record<string, unknown> : null
  const disk = record.disk && typeof record.disk === 'object' ? record.disk as Record<string, unknown> : null

  return {
    memory: memory && typeof memory.used === 'number' && typeof memory.total === 'number'
      ? { used: memory.used, total: memory.total }
      : undefined,
    disk: disk
      ? { usage: typeof disk.usage === 'string' ? disk.usage : undefined }
      : undefined,
    processes: Array.isArray(record.processes) ? record.processes : undefined,
  }
}

interface MenuItem {
  id: string
  label: string
  icon: string
  description?: string
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Overview', icon: '📊', description: 'System dashboard' },
  { id: 'chat', label: 'Chat', icon: '💬', description: 'Agent chat sessions' },
  { id: 'tasks', label: 'Task Board', icon: '📋', description: 'Kanban task management' },
  { id: 'agents', label: 'Agent Squad', icon: '🤖', description: 'Agent management & status' },
  { id: 'activity', label: 'Activity Feed', icon: '📣', description: 'Real-time activity stream' },
  { id: 'notifications', label: 'Notifications', icon: '🔔', description: 'Mentions & alerts' },
  { id: 'standup', label: 'Daily Standup', icon: '📈', description: 'Generate standup reports' },
  { id: 'spawn', label: 'Spawn Agent', icon: '🚀', description: 'Launch new sub-agents' },
  { id: 'logs', label: 'Logs', icon: '📝', description: 'Real-time log viewer' },
  { id: 'active-runs', label: 'Active Runs', icon: '🔄', description: 'Machine processes & sessions' },
  { id: 'cron', label: 'Cron Jobs', icon: '⏰', description: 'Automated tasks' },
  { id: 'memory', label: 'Memory', icon: '🧠', description: 'Knowledge browser' },
  { id: 'tokens', label: 'Tokens', icon: '💰', description: 'Usage & cost tracking' },
  { id: 'channels', label: 'Channels', icon: '📡', description: 'Messaging platform status' },
  { id: 'nodes', label: 'Nodes', icon: '🖥', description: 'Connected instances' },
  { id: 'exec-approvals', label: 'Approvals', icon: '✅', description: 'Exec approval queue' },
  { id: 'debug', label: 'Debug', icon: '🐛', description: 'System diagnostics' },
]

export function Sidebar() {
  const { activeTab, connection, sessions } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/status?action=overview')
      .then(res => res.json())
      .then(data => { if (!cancelled) setSystemStats(readSystemStats(data)) })
      .catch(err => log.error('Failed to fetch system status:', err))
    return () => { cancelled = true }
  }, [])

  const activeSessions = sessions.filter(s => s.active).length
  const totalSessions = sessions.length

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Mission Control logo"
              width={32}
              height={32}
              className="w-full h-full object-cover"
            />
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
              <Button
                variant={activeTab === item.id ? 'default' : 'ghost'}
                onClick={() => navigateToPanel(item.id)}
                className={`w-full flex items-start space-x-3 px-3 py-3 h-auto rounded-lg text-left justify-start group ${
                  activeTab === item.id
                    ? 'shadow-sm'
                    : ''
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
              </Button>
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
                <span>{systemStats.disk?.usage || 'N/A'}</span>
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
