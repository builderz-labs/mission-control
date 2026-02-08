'use client'

import { useMissionControl } from '@/store'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  priority: boolean // Show in mobile bottom bar
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: <OverviewIcon />, priority: true },
  { id: 'agents', label: 'Agents', icon: <AgentsIcon />, priority: true },
  { id: 'tasks', label: 'Tasks', icon: <TasksIcon />, priority: true },
  { id: 'sessions', label: 'Sessions', icon: <SessionsIcon />, priority: false },
  { id: 'activity', label: 'Activity', icon: <ActivityIcon />, priority: true },
  { id: 'logs', label: 'Logs', icon: <LogsIcon />, priority: true },
  { id: 'spawn', label: 'Spawn', icon: <SpawnIcon />, priority: false },
  { id: 'cron', label: 'Cron', icon: <CronIcon />, priority: false },
  { id: 'memory', label: 'Memory', icon: <MemoryIcon />, priority: false },
  { id: 'tokens', label: 'Tokens', icon: <TokensIcon />, priority: false },
  { id: 'users', label: 'Users', icon: <UsersIcon />, priority: false },
]

export function NavRail() {
  const { activeTab, setActiveTab, connection } = useMissionControl()

  return (
    <>
      {/* Desktop: Side rail */}
      <nav className="hidden md:flex w-14 bg-card border-r border-border flex-col items-center py-3 shrink-0">
        {/* Logo */}
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center mb-4">
          <span className="text-primary-foreground font-bold text-xs">MC</span>
        </div>

        {/* Nav Items */}
        <div className="flex-1 flex flex-col items-center gap-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-smooth group relative ${
                activeTab === item.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <div className="w-5 h-5">{item.icon}</div>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover text-popover-foreground border border-border rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                {item.label}
              </span>
              {/* Active indicator */}
              {activeTab === item.id && (
                <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />
              )}
            </button>
          ))}
        </div>

        {/* Connection indicator */}
        <div className="mt-2 flex flex-col items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              connection.isConnected ? 'bg-green-500 pulse-dot' : 'bg-red-500'
            }`}
            title={connection.isConnected ? 'Gateway connected' : 'Gateway disconnected'}
          />
        </div>
      </nav>

      {/* Mobile: Bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around px-2 py-1">
          {navItems.filter(i => i.priority).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-smooth min-w-0 ${
                activeTab === item.id
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <div className="w-5 h-5">{item.icon}</div>
              <span className="text-2xs font-medium truncate">{item.label}</span>
            </button>
          ))}
          {/* More menu for non-priority items */}
          <MobileMoreMenu items={navItems.filter(i => !i.priority)} activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
      </nav>
    </>
  )
}

function MobileMoreMenu({ items, activeTab, setActiveTab }: {
  items: NavItem[]
  activeTab: string
  setActiveTab: (tab: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-smooth ${
          items.some(i => i.id === activeTab) ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <div className="w-5 h-5">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="12" cy="8" r="1.5" />
          </svg>
        </div>
        <span className="text-2xs font-medium">More</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-2 right-0 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 py-1 fade-in">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-smooth ${
                  activeTab === item.id
                    ? 'text-primary bg-primary/10'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                <div className="w-4 h-4">{item.icon}</div>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Need useState for MobileMoreMenu
import { useState } from 'react'

// SVG Icons (16x16 viewbox, stroke-based)
function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  )
}

function AgentsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}

function TasksIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

function SessionsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12v9H2zM5 12v2M11 12v2M4 14h8" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,8 4,8 6,3 8,13 10,6 12,8 15,8" />
    </svg>
  )
}

function LogsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

function SpawnIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v12M8 2l-3 3M8 2l3 3" />
      <path d="M3 10h10" />
    </svg>
  )
}

function CronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v4l2.5 2.5" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="8" rx="6" ry="3" />
      <path d="M2 8v3c0 1.7 2.7 3 6 3s6-1.3 6-3V8" />
      <path d="M2 5v3c0 1.7 2.7 3 6 3s6-1.3 6-3V5" />
    </svg>
  )
}

function TokensIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v8M5.5 6h5a1.5 1.5 0 010 3H6" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
      <circle cx="11.5" cy="5.5" r="2" />
      <path d="M14.5 14c0-2 -1.5-3.5-3-3.5" />
    </svg>
  )
}
