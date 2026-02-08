'use client'

import { useState, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

export function Dashboard() {
  const {
    sessions,
    setSessions,
    connection,
    logs,
    spawnRequests,
    agents,
    tasks,
  } = useMissionControl()

  const [systemStats, setSystemStats] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadSystemStats = useCallback(async () => {
    try {
      const res = await fetch('/api/status?action=overview')
      if (!res.ok) return
      const data = await res.json()
      if (data && !data.error) setSystemStats(data)
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) return
      const data = await res.json()
      if (data && !data.error) setSessions(data.sessions || data)
    } catch {
      // silent
    }
  }, [setSessions])

  // Smart polling (60s, visibility-aware; sessions come via WS tick events)
  const pollDashboard = useCallback(() => {
    loadSystemStats()
    loadSessions()
  }, [loadSystemStats, loadSessions])

  useSmartPoll(pollDashboard, 60000)

  const activeSessions = sessions.filter(s => s.active).length
  const errorCount = logs.filter(l => l.level === 'error').length
  const runningTasks = tasks.filter(t => t.status === 'in_progress').length
  const onlineAgents = agents.filter(a => a.status !== 'offline').length

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg shimmer" />
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 rounded-lg shimmer" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Active Sessions"
          value={activeSessions}
          total={sessions.length}
          icon={<SessionIcon />}
          color="blue"
        />
        <MetricCard
          label="Agents Online"
          value={onlineAgents}
          total={agents.length}
          icon={<AgentIcon />}
          color="green"
        />
        <MetricCard
          label="Tasks Running"
          value={runningTasks}
          total={tasks.length}
          icon={<TaskIcon />}
          color="purple"
        />
        <MetricCard
          label="Errors (24h)"
          value={errorCount}
          icon={<ErrorIcon />}
          color={errorCount > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Sessions */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Sessions</h3>
            <span className="text-2xs text-muted-foreground font-mono-tight">{sessions.length}</span>
          </div>
          <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No sessions</div>
            ) : (
              sessions.slice(0, 8).map((session) => (
                <div key={session.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-secondary/30 transition-smooth">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${session.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate font-mono-tight">
                      {session.key || session.id}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      {session.kind} · {session.model?.split('/').pop() || 'unknown'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xs font-mono-tight text-muted-foreground">{session.tokens}</div>
                    <div className="text-2xs text-muted-foreground">{session.age}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">System Health</h3>
            <StatusBadge connected={connection.isConnected} />
          </div>
          <div className="panel-body space-y-3">
            <HealthRow label="Gateway" value={connection.isConnected ? 'Connected' : 'Disconnected'} status={connection.isConnected ? 'good' : 'bad'} />
            {systemStats?.memory && (
              <HealthRow
                label="Memory"
                value={`${Math.round((systemStats.memory.used / systemStats.memory.total) * 100)}%`}
                status={systemStats.memory.used / systemStats.memory.total > 0.9 ? 'bad' : 'good'}
                bar={Math.round((systemStats.memory.used / systemStats.memory.total) * 100)}
              />
            )}
            {systemStats?.disk && (
              <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status="good" />
            )}
            {systemStats?.uptime != null && (
              <HealthRow label="Uptime" value={formatUptime(systemStats.uptime)} status="good" />
            )}
            <HealthRow label="Errors" value={String(errorCount)} status={errorCount > 0 ? 'warn' : 'good'} />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Recent Logs</h3>
          </div>
          <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
            {logs.slice(0, 8).map((log) => (
              <div key={log.id} className="px-4 py-2 hover:bg-secondary/30 transition-smooth">
                <div className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    log.level === 'error' ? 'bg-red-500' :
                    log.level === 'warn' ? 'bg-amber-500' :
                    log.level === 'debug' ? 'bg-gray-500' :
                    'bg-blue-500/50'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground/80 break-words">
                      {log.message.length > 80 ? log.message.slice(0, 80) + '...' : log.message}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-2xs text-muted-foreground font-mono-tight">{log.source}</span>
                      <span className="text-2xs text-muted-foreground/40">·</span>
                      <span className="text-2xs text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No logs yet</div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Quick Actions</h3>
          </div>
          <div className="panel-body grid grid-cols-2 gap-2">
            <QuickAction
              label="Spawn Agent"
              desc="Launch sub-agent"
              tab="spawn"
              icon={<SpawnActionIcon />}
            />
            <QuickAction
              label="View Logs"
              desc="Real-time viewer"
              tab="logs"
              icon={<LogActionIcon />}
            />
            <QuickAction
              label="Task Board"
              desc="Kanban view"
              tab="tasks"
              icon={<TaskActionIcon />}
            />
            <QuickAction
              label="Memory"
              desc="Knowledge base"
              tab="memory"
              icon={<MemoryActionIcon />}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Sub-components ---

function MetricCard({ label, value, total, icon, color }: {
  label: string
  value: number
  total?: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'red'
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
  }

  return (
    <div className={`rounded-lg border p-3.5 ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium opacity-80">{label}</span>
        <div className="w-5 h-5 opacity-60">{icon}</div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono-tight">{value}</span>
        {total != null && (
          <span className="text-xs opacity-50 font-mono-tight">/ {total}</span>
        )}
      </div>
    </div>
  )
}

function HealthRow({ label, value, status, bar }: {
  label: string
  value: string
  status: 'good' | 'warn' | 'bad'
  bar?: number
}) {
  const statusColor = status === 'good' ? 'text-green-400' : status === 'warn' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-medium font-mono-tight ${statusColor}`}>{value}</span>
      </div>
      {bar != null && (
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              bar > 90 ? 'bg-red-500' : bar > 70 ? 'bg-amber-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(bar, 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${
      connected ? 'badge-success' : 'badge-error'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
      {connected ? 'Online' : 'Offline'}
    </span>
  )
}

function QuickAction({ label, desc, tab, icon }: { label: string; desc: string; tab: string; icon: React.ReactNode }) {
  const { setActiveTab } = useMissionControl()

  return (
    <button
      onClick={() => setActiveTab(tab)}
      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-smooth text-left group"
    >
      <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-smooth">
        <div className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-smooth">{icon}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-2xs text-muted-foreground">{desc}</div>
      </div>
    </button>
  )
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  return `${hours}h`
}

// Mini SVG icons for metric cards
function SessionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 3h12v9H2zM5 12v2M11 12v2M4 14h8" />
    </svg>
  )
}
function AgentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}
function TaskIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}
function ErrorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 1l7 13H1L8 1zM8 6v3M8 11.5v.5" />
    </svg>
  )
}
function SpawnActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 2v12M8 2l-3 3M8 2l3 3" />
    </svg>
  )
}
function LogActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}
function TaskActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5l2 2 3-3" />
      <path d="M5 10h6" />
    </svg>
  )
}
function MemoryActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <ellipse cx="8" cy="8" rx="6" ry="3" />
      <path d="M2 8v3c0 1.7 2.7 3 6 3s6-1.3 6-3V8" />
    </svg>
  )
}
