'use client'

import { useState, useMemo } from 'react'
import { useMissionControl, type Agent, type Activity } from '@/store'
import { Button } from '@/components/ui/button'

/**
 * BridgePage — the "at a glance" view of the entire agent squad.
 *
 * Layout:
 *   Left (flex-1): Agent player card grid
 *   Right (w-72): Ambient sidebar (recent activity, active sessions, connection)
 */
export function BridgePage() {
  const { agents, activities, sessions, connection } = useMissionControl()
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  // Sort: busy first, then idle, then offline/error
  const sortedAgents = useMemo(() => {
    const order: Record<string, number> = { busy: 0, idle: 1, error: 2, offline: 3 }
    return [...agents].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4))
  }, [agents])

  const recentActivities = useMemo(
    () => [...activities].sort((a, b) => b.created_at - a.created_at).slice(0, 12),
    [activities]
  )

  const activeSessions = useMemo(
    () => sessions.filter(s => s.active),
    [sessions]
  )

  return (
    <div className="flex h-full">
      {/* Agent Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <h2 className="font-heading text-xl font-semibold text-foreground">Agent Squad</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {agents.length} agents registered · {agents.filter(a => a.status === 'idle' || a.status === 'busy').length} online
          </p>
        </div>

        {agents.length === 0 ? (
          <div className="desk-panel p-8 text-center">
            <p className="text-sm text-muted-foreground">No agents registered yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Agents will appear here once they connect to the gateway.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                isSelected={selectedAgent?.id === agent.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Ambient Sidebar */}
      <aside className="hidden lg:flex w-72 h-full border-l border-border bg-card flex-col shrink-0">
        {/* Recent Activity */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Activity</h3>
          </div>
          <div className="divide-y divide-border/40">
            {recentActivities.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">No recent activity</div>
            ) : (
              recentActivities.map(act => (
                <ActivityRow key={act.id} activity={act} />
              ))
            )}
          </div>
        </div>

        {/* Active Sessions */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Sessions</h3>
          <div className="space-y-1.5">
            {activeSessions.length === 0 ? (
              <p className="text-2xs text-muted-foreground">No active sessions</p>
            ) : (
              activeSessions.slice(0, 5).map(session => (
                <div key={session.id} className="flex items-center gap-2 text-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  <span className="text-foreground truncate flex-1 font-mono-tight">{session.key || session.id}</span>
                  <span className="text-muted-foreground">{session.model?.split('/').pop()?.slice(0, 8)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Connection Status */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connection</h3>
          <div className="space-y-1">
            <StatusRow label="WebSocket" connected={connection.isConnected} latency={connection.latency} />
            <StatusRow label="SSE" connected={connection.sseConnected ?? false} />
          </div>
        </div>
      </aside>

      {/* Agent Detail Overlay */}
      {selectedAgent && (
        <AgentOverlay agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  )
}

// ─── Agent Card ───

const statusDotColor: Record<string, string> = {
  idle: 'bg-success',
  busy: 'bg-warning',
  error: 'bg-destructive',
  offline: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  idle: 'Online',
  busy: 'Busy',
  error: 'Error',
  offline: 'Offline',
}

const accentBorder: Record<string, string> = {
  idle: 'desk-card-accent-sage',
  busy: 'desk-card-accent-kraft',
  error: 'desk-card-accent-terracotta',
  offline: '',
}

function AgentCard({ agent, onClick, isSelected }: { agent: Agent; onClick: () => void; isSelected: boolean }) {
  const lastSeen = agent.last_seen ? formatRelativeTime(agent.last_seen * 1000) : 'never'
  const stats = agent.taskStats

  return (
    <button
      onClick={onClick}
      className={`desk-panel text-left w-full p-4 transition-all duration-200 hover:shadow-lg ${accentBorder[agent.status] || ''} ${
        isSelected ? 'ring-2 ring-primary/40' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">{agent.name}</h3>
          <p className="text-2xs text-muted-foreground truncate mt-0.5">{agent.role}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className={`w-2 h-2 rounded-full ${statusDotColor[agent.status] || 'bg-muted-foreground/40'} ${agent.status === 'busy' ? 'pulse-dot' : ''}`} />
          <span className="text-2xs font-medium text-muted-foreground">{statusLabel[agent.status] || agent.status}</span>
        </div>
      </div>

      {/* Last activity */}
      {agent.last_activity && (
        <p className="text-2xs text-muted-foreground/80 mb-3 line-clamp-2">
          {agent.last_activity}
        </p>
      )}

      {/* Task stats bar */}
      {stats && stats.total > 0 && (
        <div className="flex items-center gap-3 text-2xs text-muted-foreground">
          <span>{stats.assigned ?? 0} assigned</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{stats.in_progress ?? 0} active</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{stats.done ?? 0} done</span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
        <span className="text-2xs text-muted-foreground">Last seen {lastSeen}</span>
        <span className="text-2xs text-primary font-medium">Details →</span>
      </div>
    </button>
  )
}

// ─── Agent Overlay ───

function AgentOverlay({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const stats = agent.taskStats

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-foreground/5 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card border-l border-border shadow-2xl slide-in-right overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-foreground">{agent.name}</h2>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary text-2xs">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor[agent.status]}`} />
              <span className="font-medium">{statusLabel[agent.status]}</span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </Button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Identity */}
          <Section title="Identity">
            <InfoRow label="Agent ID" value={String(agent.id)} mono />
            {agent.session_key && <InfoRow label="Session Key" value={agent.session_key} mono />}
            <InfoRow label="Created" value={new Date(agent.created_at * 1000).toLocaleDateString()} />
            <InfoRow label="Last Seen" value={agent.last_seen ? formatRelativeTime(agent.last_seen * 1000) + ' ago' : 'Never'} />
          </Section>

          {/* Task Stats */}
          {stats && stats.total > 0 && (
            <Section title="Task Summary">
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="Assigned" value={stats.assigned ?? 0} />
                <StatBox label="In Progress" value={stats.in_progress ?? 0} />
                <StatBox label="In Review" value={stats.quality_review ?? 0} />
                <StatBox label="Completed" value={stats.done ?? 0} />
                <StatBox label="Total" value={stats.total} />
              </div>
            </Section>
          )}

          {/* Last Activity */}
          {agent.last_activity && (
            <Section title="Last Activity">
              <p className="text-sm text-foreground/90">{agent.last_activity}</p>
            </Section>
          )}

          {/* Soul / Working Memory */}
          {agent.soul_content && (
            <Section title="Soul">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{agent.soul_content}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared Primitives ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-foreground ${mono ? 'font-mono-tight text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-2.5 text-center">
      <div className="text-lg font-semibold font-mono-tight text-foreground">{value}</div>
      <div className="text-2xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function ActivityRow({ activity }: { activity: Activity }) {
  const timeStr = formatRelativeTime(activity.created_at * 1000)
  return (
    <div className="px-4 py-2.5 hover:bg-secondary/30 transition-smooth">
      <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">{activity.description}</p>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-2xs text-muted-foreground font-mono-tight">{activity.actor}</span>
        <span className="text-2xs text-muted-foreground/40">·</span>
        <span className="text-2xs text-muted-foreground">{timeStr}</span>
      </div>
    </div>
  )
}

function StatusRow({ label, connected, latency }: { label: string; connected: boolean; latency?: number | null }) {
  return (
    <div className="flex items-center justify-between text-2xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-muted-foreground/30'}`} />
        <span className={connected ? 'text-success font-medium' : 'text-muted-foreground'}>
          {connected ? (latency != null ? `${latency}ms` : 'Live') : 'Off'}
        </span>
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
