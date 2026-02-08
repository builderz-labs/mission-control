'use client'

import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { DigitalClock } from '@/components/ui/digital-clock'

export function HeaderBar() {
  const { activeTab, connection, sessions, chatPanelOpen, setChatPanelOpen, notifications, unreadNotificationCount } = useMissionControl()
  const { isConnected, reconnect } = useWebSocket()

  const activeSessions = sessions.filter(s => s.active).length
  const tabLabels: Record<string, string> = {
    overview: 'Overview',
    agents: 'Agent Squad',
    tasks: 'Task Board',
    sessions: 'Sessions',
    activity: 'Activity Feed',
    notifications: 'Notifications',
    standup: 'Daily Standup',
    logs: 'Log Viewer',
    spawn: 'Spawn Agent',
    cron: 'Cron Jobs',
    memory: 'Memory Browser',
    tokens: 'Token Usage',
  }

  return (
    <header className="h-12 bg-card/80 backdrop-blur-sm border-b border-border px-4 flex items-center justify-between shrink-0">
      {/* Left: Page title + breadcrumb */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-foreground">
          {tabLabels[activeTab] || 'Mission Control'}
        </h1>
        <span className="text-2xs text-muted-foreground font-mono-tight">
          v2.0
        </span>
      </div>

      {/* Center: Quick stats */}
      <div className="hidden md:flex items-center gap-4">
        <Stat label="Sessions" value={`${activeSessions}/${sessions.length}`} />
        <Stat label="Gateway" value={connection.isConnected ? 'Online' : 'Offline'} status={connection.isConnected ? 'success' : 'error'} />
        {connection.latency != null && (
          <Stat label="Latency" value={`${connection.latency}ms`} />
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <DigitalClock />

        {/* Chat toggle */}
        <button
          onClick={() => setChatPanelOpen(!chatPanelOpen)}
          className={`h-8 px-2.5 rounded-md text-xs font-medium transition-smooth flex items-center gap-1.5 ${
            chatPanelOpen
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          <ChatIcon />
          Chat
        </button>

        {/* Notifications */}
        <button
          onClick={() => {
            const { setActiveTab } = useMissionControl.getState()
            setActiveTab('notifications')
          }}
          className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth flex items-center justify-center relative"
        >
          <BellIcon />
          {unreadNotificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-2xs flex items-center justify-center font-medium">
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </button>

        {/* Reconnect button (only when disconnected) */}
        {!connection.isConnected && (
          <button
            onClick={() => reconnect()}
            className="h-8 px-2.5 rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 transition-smooth"
          >
            Reconnect
          </button>
        )}

        <ThemeToggle />
      </div>
    </header>
  )
}

function Stat({ label, value, status }: { label: string; value: string; status?: 'success' | 'error' | 'warning' }) {
  const statusColor = status === 'success' ? 'text-green-400' : status === 'error' ? 'text-red-400' : status === 'warning' ? 'text-amber-400' : 'text-foreground'

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium font-mono-tight ${statusColor}`}>{value}</span>
    </div>
  )
}

function ChatIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12v8H6l-3 3v-3H2V3z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
    </svg>
  )
}
