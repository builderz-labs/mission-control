'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { DigitalClock } from '@/components/ui/digital-clock'

export function HeaderBar() {
  const { activeTab, connection, sessions, chatPanelOpen, setChatPanelOpen, notifications, unreadNotificationCount, currentUser, setCurrentUser } = useMissionControl()
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
        <ConnectionBadge connection={connection} onReconnect={reconnect} />
        <SseBadge connected={connection.sseConnected ?? false} />
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

        <ThemeToggle />

        {/* User menu */}
        {currentUser && (
          <UserMenu user={currentUser} onLogout={() => setCurrentUser(null)} />
        )}
      </div>
    </header>
  )
}

function ConnectionBadge({
  connection,
  onReconnect,
}: {
  connection: { isConnected: boolean; reconnectAttempts: number; latency?: number }
  onReconnect: () => void
}) {
  const isReconnecting = !connection.isConnected && connection.reconnectAttempts > 0

  let dotClass: string
  let label: string

  if (connection.isConnected) {
    dotClass = 'bg-green-500'
    label = connection.latency != null ? `${connection.latency}ms` : 'Online'
  } else if (isReconnecting) {
    dotClass = 'bg-amber-500 animate-pulse'
    label = `Connecting... (${connection.reconnectAttempts})`
  } else {
    dotClass = 'bg-red-500 animate-pulse'
    label = 'Disconnected'
  }

  return (
    <button
      onClick={!connection.isConnected ? onReconnect : undefined}
      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-smooth ${
        connection.isConnected
          ? 'cursor-default'
          : 'hover:bg-secondary cursor-pointer'
      }`}
      title={connection.isConnected ? 'Gateway connected' : 'Click to reconnect'}
    >
      <span className="text-muted-foreground">Gateway</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className={`font-medium font-mono-tight ${
        connection.isConnected ? 'text-green-400' : isReconnecting ? 'text-amber-400' : 'text-red-400'
      }`}>
        {label}
      </span>
    </button>
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

function SseBadge({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Events</span>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-blue-500' : 'bg-muted-foreground/30'}`} />
      <span className={`font-medium font-mono-tight ${connected ? 'text-blue-400' : 'text-muted-foreground'}`}>
        {connected ? 'Live' : 'Off'}
      </span>
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

function UserMenu({ user, onLogout }: { user: { username: string; display_name: string; role: string }; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const initials = user.display_name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    onLogout()
    router.push('/login')
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-8 w-8 rounded-full bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center hover:bg-primary/30 transition-smooth"
        title={`${user.display_name} (${user.role})`}
      >
        {initials}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-card border border-border shadow-lg z-50 py-1">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium text-foreground">{user.display_name}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full px-3 py-2 text-sm text-left text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
    </svg>
  )
}
