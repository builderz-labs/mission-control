'use client'

import { useState, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface DbStats {
  tasks: { total: number; byStatus: Record<string, number> }
  agents: { total: number; byStatus: Record<string, number> }
  audit: { day: number; week: number; loginFailures: number }
  activities: { day: number }
  notifications: { unread: number }
  pipelines: { active: number; recentDay: number }
  backup: { name: string; size: number; age_hours: number } | null
  dbSizeBytes: number
  webhookCount: number
}

interface ClaudeStats {
  total_sessions: number
  active_sessions: number
  total_input_tokens: number
  total_output_tokens: number
  total_estimated_cost: number
  unique_projects: number
}

export function Dashboard() {
  const {
    sessions,
    setSessions,
    connection,
    dashboardMode,
    subscription,
    logs,
    agents,
    tasks,
  } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'
  const subscriptionLabel = subscription?.type
    ? subscription.type.charAt(0).toUpperCase() + subscription.type.slice(1)
    : null

  const [systemStats, setSystemStats] = useState<any>(null)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [claudeStats, setClaudeStats] = useState<ClaudeStats | null>(null)
  const [githubStats, setGithubStats] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    try {
      const fetches: Promise<Response>[] = [
        fetch('/api/status?action=dashboard'),
        fetch('/api/sessions'),
      ]
      if (isLocal) {
        fetches.push(fetch('/api/claude/sessions'))
        fetches.push(fetch('/api/github?action=stats'))
      }

      const [dashRes, sessRes, claudeRes, ghRes] = await Promise.all(fetches)

      if (dashRes.ok) {
        const data = await dashRes.json()
        if (data && !data.error) {
          setSystemStats(data)
          if (data.db) setDbStats(data.db)
        }
      }

      if (sessRes.ok) {
        const data = await sessRes.json()
        if (data && !data.error) setSessions(data.sessions || data)
      }

      if (claudeRes?.ok) {
        const data = await claudeRes.json()
        if (data?.stats) setClaudeStats(data.stats)
      }

      if (ghRes?.ok) {
        const data = await ghRes.json()
        if (data && !data.error) setGithubStats(data)
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [setSessions, isLocal])

  useSmartPoll(loadDashboard, 60000, { pauseWhenConnected: true })

  const activeSessions = sessions.filter(s => s.active).length
  const errorCount = logs.filter(l => l.level === 'error').length
  const runningTasks = dbStats?.tasks.byStatus?.in_progress ?? tasks.filter(t => t.status === 'in_progress').length
  const onlineAgents = dbStats ? (dbStats.agents.total - (dbStats.agents.byStatus?.offline ?? 0)) : agents.filter(a => a.status !== 'offline').length

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg shimmer" />
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-lg shimmer" />
          ))}
        </div>
      </div>
    )
  }

  const memPct = systemStats?.memory?.total
    ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100)
    : null

  return (
    <div className="p-5 space-y-5">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLocal ? (
          <>
            <div className="cursor-pointer" onClick={() => navigateToPanel('sessions')}>
              <MetricCard
                label="Active Sessions"
                value={claudeStats?.active_sessions ?? activeSessions}
                total={claudeStats?.total_sessions ?? sessions.length}
                icon={<SessionIcon />}
                color="blue"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('sessions')}>
              <MetricCard
                label="Projects"
                value={claudeStats?.unique_projects ?? 0}
                icon={<ProjectIcon />}
                color="green"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('tokens')}>
              <MetricCard
                label="Tokens Used"
                value={formatTokensShort((claudeStats?.total_input_tokens ?? 0) + (claudeStats?.total_output_tokens ?? 0))}
                subtitle={claudeStats ? `${formatTokensShort(claudeStats.total_input_tokens)} in / ${formatTokensShort(claudeStats.total_output_tokens)} out` : undefined}
                icon={<TokenIcon />}
                color="purple"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('tokens')}>
              <MetricCard
                label="Est. Cost"
                value={subscriptionLabel ? `Included` : `$${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}`}
                subtitle={subscriptionLabel ? `${subscriptionLabel} plan` : undefined}
                icon={<CostIcon />}
                color={subscriptionLabel ? 'green' : (claudeStats && claudeStats.total_estimated_cost > 10 ? 'red' : 'green')}
              />
            </div>
          </>
        ) : (
          <>
            <div className="cursor-pointer" onClick={() => navigateToPanel('history')}>
              <MetricCard
                label="Active Sessions"
                value={activeSessions}
                total={sessions.length}
                icon={<SessionIcon />}
                color="blue"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('agents')}>
              <MetricCard
                label="Agents Online"
                value={onlineAgents}
                total={dbStats?.agents.total ?? agents.length}
                icon={<AgentIcon />}
                color="green"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('tasks')}>
              <MetricCard
                label="Tasks Running"
                value={runningTasks}
                total={dbStats?.tasks.total ?? tasks.length}
                icon={<TaskIcon />}
                color="purple"
              />
            </div>
            <div className="cursor-pointer" onClick={() => navigateToPanel('logs')}>
              <MetricCard
                label="Errors (24h)"
                value={errorCount}
                icon={<ErrorIcon />}
                color={errorCount > 0 ? 'red' : 'green'}
              />
            </div>
          </>
        )}
      </div>

      {/* Three-column layout */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* System Health */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">System Health</h3>
            {isLocal ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Local
              </span>
            ) : (
              <StatusBadge connected={connection.isConnected} />
            )}
          </div>
          <div className="panel-body space-y-3">
            {isLocal ? (
              <HealthRow label="Mode" value="Local" status="good" />
            ) : (
              <HealthRow
                label="Gateway"
                value={connection.isConnected ? 'Connected' : 'Disconnected'}
                status={connection.isConnected ? 'good' : 'bad'}
              />
            )}
            {memPct != null && (
              <HealthRow
                label="Memory"
                value={`${memPct}%`}
                status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'}
                bar={memPct}
              />
            )}
            {systemStats?.disk && (
              <HealthRow
                label="Disk"
                value={systemStats.disk.usage || 'N/A'}
                status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'}
              />
            )}
            {systemStats?.uptime != null && (
              <HealthRow label="Uptime" value={formatUptime(systemStats.uptime)} status="good" />
            )}
            {dbStats && (
              <HealthRow
                label="DB Size"
                value={formatBytes(dbStats.dbSizeBytes)}
                status="good"
              />
            )}
            <HealthRow
              label="Errors"
              value={String(errorCount)}
              status={errorCount > 0 ? 'warn' : 'good'}
            />
          </div>
        </div>

        {/* Middle panel: Claude Stats (local) or Security & Audit (full) */}
        {isLocal ? (
          <div className="panel cursor-pointer hover:border-primary/30 transition-smooth" onClick={() => navigateToPanel('sessions')}>
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">Claude Code Stats</h3>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {claudeStats?.total_sessions ?? 0} sessions
              </span>
            </div>
            <div className="panel-body space-y-3">
              <StatRow label="Total sessions" value={claudeStats?.total_sessions ?? 0} />
              <StatRow label="Active now" value={claudeStats?.active_sessions ?? 0} />
              <StatRow label="Unique projects" value={claudeStats?.unique_projects ?? 0} />
              <div className="pt-1 border-t border-border/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Input tokens</span>
                  <span className="text-xs font-medium font-mono-tight text-muted-foreground">
                    {formatTokensShort(claudeStats?.total_input_tokens ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Output tokens</span>
                  <span className="text-xs font-medium font-mono-tight text-muted-foreground">
                    {formatTokensShort(claudeStats?.total_output_tokens ?? 0)}
                  </span>
                </div>
              </div>
              <div className="pt-1 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Estimated cost</span>
                  {subscriptionLabel ? (
                    <span className="text-xs font-medium font-mono-tight text-green-400">
                      Included ({subscriptionLabel})
                    </span>
                  ) : (
                    <span className={`text-xs font-medium font-mono-tight ${
                      (claudeStats?.total_estimated_cost ?? 0) > 10 ? 'text-amber-400' : 'text-green-400'
                    }`}>
                      ${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="panel cursor-pointer hover:border-primary/30 transition-smooth" onClick={() => navigateToPanel('audit')}>
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">Security & Audit</h3>
              {dbStats && dbStats.audit.loginFailures > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                  {dbStats.audit.loginFailures} failed login{dbStats.audit.loginFailures > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="panel-body space-y-3">
              <StatRow label="Audit events (24h)" value={dbStats?.audit.day ?? 0} />
              <StatRow label="Audit events (7d)" value={dbStats?.audit.week ?? 0} />
              <StatRow
                label="Login failures (24h)"
                value={dbStats?.audit.loginFailures ?? 0}
                alert={dbStats ? dbStats.audit.loginFailures > 0 : false}
              />
              <StatRow label="Activities (24h)" value={dbStats?.activities.day ?? 0} />
              <StatRow label="Webhooks configured" value={dbStats?.webhookCount ?? 0} />
              <div className="pt-1 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Unread notifications</span>
                  <span className={`text-xs font-medium font-mono-tight ${
                    (dbStats?.notifications.unread ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'
                  }`}>
                    {dbStats?.notifications.unread ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Third column: GitHub (local) or Backup & Pipelines (full) */}
        {isLocal ? (
          <div className="panel">
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">GitHub</h3>
              {githubStats?.user && (
                <span className="text-2xs text-muted-foreground font-mono-tight">@{githubStats.user.login}</span>
              )}
            </div>
            <div className="panel-body space-y-3">
              {githubStats ? (
                <>
                  <StatRow label="Active repos" value={githubStats.repos.total} />
                  <StatRow label="Public" value={githubStats.repos.public} />
                  <StatRow label="Private" value={githubStats.repos.private} />
                  <div className="pt-1 border-t border-border/50 space-y-2">
                    <StatRow label="Total stars" value={githubStats.repos.total_stars} />
                    <StatRow label="Total forks" value={githubStats.repos.total_forks} />
                    <StatRow label="Open issues" value={githubStats.repos.total_open_issues} />
                  </div>
                  {githubStats.topLanguages.length > 0 && (
                    <div className="pt-1 border-t border-border/50">
                      <div className="text-xs text-muted-foreground mb-1.5">Top languages</div>
                      <div className="flex flex-wrap gap-1.5">
                        {githubStats.topLanguages.map((lang: { name: string; count: number }) => (
                          <span
                            key={lang.name}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono-tight bg-secondary text-muted-foreground"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${langColor(lang.name)}`} />
                            {lang.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground">No GitHub token configured</p>
                  <p className="text-2xs text-muted-foreground/60 mt-1">Set GITHUB_TOKEN in .env.local</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <h3 className="text-sm font-semibold text-foreground">Backup & Pipelines</h3>
            </div>
            <div className="panel-body space-y-3">
              {dbStats?.backup ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Latest backup</span>
                    <span className={`text-xs font-medium font-mono-tight ${
                      dbStats.backup.age_hours > 48 ? 'text-red-400' :
                      dbStats.backup.age_hours > 24 ? 'text-amber-400' : 'text-green-400'
                    }`}>
                      {dbStats.backup.age_hours < 1 ? '<1h ago' : `${dbStats.backup.age_hours}h ago`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Backup size</span>
                    <span className="text-xs font-mono-tight text-muted-foreground">
                      {formatBytes(dbStats.backup.size)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Latest backup</span>
                  <span className="text-xs font-medium text-amber-400">None</span>
                </div>
              )}
              <div className="pt-1 border-t border-border/50 space-y-2">
                <StatRow label="Active pipelines" value={dbStats?.pipelines.active ?? 0} />
                <StatRow label="Pipeline runs (24h)" value={dbStats?.pipelines.recentDay ?? 0} />
              </div>
              <div className="pt-1 border-t border-border/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Tasks by status</span>
                </div>
                {dbStats?.tasks.total ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(dbStats.tasks.byStatus).map(([status, count]) => (
                      <span
                        key={status}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono-tight bg-secondary text-muted-foreground"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${taskStatusColor(status)}`} />
                        {status}: {count}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-2xs text-muted-foreground">No tasks</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom two-column: Sessions + Logs */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Sessions */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Sessions</h3>
            <span className="text-2xs text-muted-foreground font-mono-tight">{sessions.length}</span>
          </div>
          <div className="divide-y divide-border/50 max-h-56 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-center"><p className="text-xs text-muted-foreground">No active sessions</p><p className="text-2xs text-muted-foreground/60 mt-1">{isLocal ? 'Sessions appear when Claude Code or Codex CLI are running' : 'Sessions appear when agents connect via gateway'}</p></div>
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

        {/* Recent Logs */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="text-sm font-semibold text-foreground">Recent Logs</h3>
          </div>
          <div className="divide-y divide-border/50 max-h-56 overflow-y-auto">
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
              <div className="px-4 py-8 text-center"><p className="text-xs text-muted-foreground">No logs yet</p><p className="text-2xs text-muted-foreground/60 mt-1">Logs stream here when agents run</p></div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {!isLocal && (
          <QuickAction label="Spawn Agent" desc="Launch sub-agent" tab="spawn" icon={<SpawnActionIcon />} onNavigate={navigateToPanel} />
        )}
        <QuickAction label="View Logs" desc="Real-time viewer" tab="logs" icon={<LogActionIcon />} onNavigate={navigateToPanel} />
        <QuickAction label="Task Board" desc="Kanban view" tab="tasks" icon={<TaskActionIcon />} onNavigate={navigateToPanel} />
        <QuickAction label="Memory" desc="Knowledge base" tab="memory" icon={<MemoryActionIcon />} onNavigate={navigateToPanel} />
        {isLocal ? (
          <QuickAction label="Sessions" desc="Claude Code sessions" tab="sessions" icon={<SessionIcon />} onNavigate={navigateToPanel} />
        ) : (
          <QuickAction label="Orchestration" desc="Workflows & pipelines" tab="agents" icon={<PipelineActionIcon />} onNavigate={navigateToPanel} />
        )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function MetricCard({ label, value, total, subtitle, icon, color }: {
  label: string
  value: number | string
  total?: number
  subtitle?: string
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
      {subtitle && (
        <div className="text-2xs opacity-50 font-mono-tight mt-0.5">{subtitle}</div>
      )}
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

function StatRow({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium font-mono-tight ${
        alert ? 'text-red-400' : 'text-muted-foreground'
      }`}>
        {value}
      </span>
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

function QuickAction({ label, desc, tab, icon, onNavigate }: {
  label: string; desc: string; tab: string; icon: React.ReactNode
  onNavigate: (tab: string) => void
}) {
  return (
    <button
      onClick={() => onNavigate(tab)}
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

// --- Utility functions ---

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  return `${hours}h`
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function langColor(lang: string): string {
  const colors: Record<string, string> = {
    TypeScript: 'bg-blue-500',
    JavaScript: 'bg-yellow-500',
    Python: 'bg-green-500',
    Rust: 'bg-orange-500',
    Go: 'bg-cyan-500',
    Ruby: 'bg-red-500',
    Java: 'bg-red-400',
    'C++': 'bg-pink-500',
    C: 'bg-gray-500',
    Shell: 'bg-emerald-500',
    Solidity: 'bg-purple-500',
    HTML: 'bg-orange-400',
    CSS: 'bg-indigo-500',
    Dart: 'bg-teal-500',
    Swift: 'bg-orange-600',
    Kotlin: 'bg-violet-500',
  }
  return colors[lang] || 'bg-muted-foreground/40'
}

function taskStatusColor(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500'
    case 'in_progress': return 'bg-blue-500'
    case 'review': case 'quality_review': return 'bg-purple-500'
    case 'assigned': return 'bg-amber-500'
    case 'inbox': return 'bg-muted-foreground/40'
    default: return 'bg-muted-foreground/30'
  }
}

// --- Mini SVG Icons ---

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
function PipelineActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="3" cy="8" r="2" />
      <circle cx="13" cy="4" r="2" />
      <circle cx="13" cy="12" r="2" />
      <path d="M5 7l6-2M5 9l6 2" />
    </svg>
  )
}
function ProjectIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4l6-2 6 2v8l-6 2-6-2V4z" />
      <path d="M8 6v8M2 4l6 2 6-2" />
    </svg>
  )
}
function TokenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v8M5 6h6M5 10h6" />
    </svg>
  )
}
function CostIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 3.5V5M8 11v1.5M10.5 6.5C10.5 5.4 9.4 4.5 8 4.5S5.5 5.4 5.5 6.5c0 1.1 1.1 2 2.5 2s2.5.9 2.5 2c0 1.1-1.1 2-2.5 2s-2.5-.9-2.5-2" />
    </svg>
  )
}
