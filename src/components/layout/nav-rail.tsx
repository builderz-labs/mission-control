'use client'

import { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  priority: boolean // Show in mobile bottom bar
}

interface NavGroup {
  id: string
  label?: string // undefined = no header (core group)
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    id: 'core',
    items: [
      { id: 'overview', label: 'Overview', icon: <OverviewIcon />, priority: true },
      { id: 'agents', label: 'Agents', icon: <AgentsIcon />, priority: true },
      { id: 'tasks', label: 'Tasks', icon: <TasksIcon />, priority: true },
      { id: 'sessions', label: 'Sessions', icon: <SessionsIcon />, priority: false },
    ],
  },
  {
    id: 'observe',
    label: 'OBSERVE',
    items: [
      { id: 'activity', label: 'Activity', icon: <ActivityIcon />, priority: true },
      { id: 'logs', label: 'Logs', icon: <LogsIcon />, priority: false },
      { id: 'tokens', label: 'Tokens', icon: <TokensIcon />, priority: false },
      { id: 'memory', label: 'Memory', icon: <MemoryIcon />, priority: false },
    ],
  },
  {
    id: 'automate',
    label: 'AUTOMATE',
    items: [
      { id: 'cron', label: 'Cron', icon: <CronIcon />, priority: false },
      { id: 'spawn', label: 'Spawn', icon: <SpawnIcon />, priority: false },
      { id: 'webhooks', label: 'Webhooks', icon: <WebhookIcon />, priority: false },
      { id: 'alerts', label: 'Alerts', icon: <AlertIcon />, priority: false },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    items: [
      { id: 'users', label: 'Users', icon: <UsersIcon />, priority: false },
      { id: 'audit', label: 'Audit', icon: <AuditIcon />, priority: false },
      { id: 'history', label: 'History', icon: <HistoryIcon />, priority: false },
      { id: 'gateways', label: 'Gateways', icon: <GatewaysIcon />, priority: false },
      { id: 'gateway-config', label: 'Config', icon: <GatewayConfigIcon />, priority: false },
      { id: 'super-admin', label: 'Super Admin', icon: <SuperAdminIcon />, priority: false },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon />, priority: false },
    ],
  },
]

// Flat list for mobile bar
const allNavItems = navGroups.flatMap(g => g.items)

export function NavRail() {
  const { activeTab, setActiveTab, connection, sidebarExpanded, collapsedGroups, toggleSidebar, toggleGroup } = useMissionControl()

  // Keyboard shortcut: [ to toggle sidebar
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '[' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toggleSidebar])

  return (
    <>
      {/* Desktop: Grouped sidebar */}
      <nav
        className={`hidden md:flex flex-col bg-card border-r border-border shrink-0 transition-all duration-200 ease-in-out ${
          sidebarExpanded ? 'w-[220px]' : 'w-14'
        }`}
      >
        {/* Header: Logo + toggle */}
        <div className={`flex items-center shrink-0 ${sidebarExpanded ? 'px-3 py-3 gap-2.5' : 'flex-col py-3 gap-2'}`}>
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-xs">MC</span>
          </div>
          {sidebarExpanded && (
            <span className="text-sm font-semibold text-foreground truncate flex-1">Mission Control</span>
          )}
          <button
            onClick={toggleSidebar}
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth shrink-0"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              {sidebarExpanded ? (
                <polyline points="10,3 5,8 10,13" />
              ) : (
                <polyline points="6,3 11,8 6,13" />
              )}
            </svg>
          </button>
        </div>

        {/* Nav groups */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          {navGroups.map((group, groupIndex) => (
            <div key={group.id}>
              {/* Divider between groups (not before first) */}
              {groupIndex > 0 && (
                <div className={`my-1.5 border-t border-border ${sidebarExpanded ? 'mx-3' : 'mx-2'}`} />
              )}

              {/* Group header (expanded mode, only for groups with labels) */}
              {sidebarExpanded && group.label && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 mt-3 mb-1 group/header"
                >
                  <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold select-none">
                    {group.label}
                  </span>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`w-3 h-3 text-muted-foreground/40 group-hover/header:text-muted-foreground transition-transform duration-150 ${
                      collapsedGroups.includes(group.id) ? '-rotate-90' : ''
                    }`}
                  >
                    <polyline points="4,6 8,10 12,6" />
                  </svg>
                </button>
              )}

              {/* Group items */}
              <div
                className={`overflow-hidden transition-all duration-150 ease-in-out ${
                  sidebarExpanded && collapsedGroups.includes(group.id) ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
                }`}
              >
                <div className={`flex flex-col ${sidebarExpanded ? 'gap-0.5 px-2' : 'items-center gap-1'}`}>
                  {group.items.map((item) => (
                    <NavButton
                      key={item.id}
                      item={item}
                      active={activeTab === item.id}
                      expanded={sidebarExpanded}
                      onClick={() => setActiveTab(item.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Connection indicator */}
        <div className={`shrink-0 py-3 flex ${sidebarExpanded ? 'px-3 items-center gap-2' : 'flex-col items-center'}`}>
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              connection.isConnected ? 'bg-green-500 pulse-dot' : 'bg-red-500'
            }`}
            title={connection.isConnected ? 'Gateway connected' : 'Gateway disconnected'}
          />
          {sidebarExpanded && (
            <span className="text-xs text-muted-foreground truncate">
              {connection.isConnected ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>
      </nav>

      {/* Mobile: Bottom tab bar */}
      <MobileBottomBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </>
  )
}

function NavButton({ item, active, expanded, onClick }: {
  item: NavItem
  active: boolean
  expanded: boolean
  onClick: () => void
}) {
  if (expanded) {
    return (
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-smooth relative ${
          active
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
        }`}
      >
        {active && (
          <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />
        )}
        <div className="w-5 h-5 shrink-0">{item.icon}</div>
        <span className="text-sm truncate">{item.label}</span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      title={item.label}
      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-smooth group relative ${
        active
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
      {active && (
        <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />
      )}
    </button>
  )
}

function MobileBottomBar({ activeTab, setActiveTab }: {
  activeTab: string
  setActiveTab: (tab: string) => void
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const priorityItems = allNavItems.filter(i => i.priority)
  const nonPriorityIds = new Set(allNavItems.filter(i => !i.priority).map(i => i.id))
  const moreIsActive = nonPriorityIds.has(activeTab)

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around px-1 h-14">
          {priorityItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg transition-smooth min-w-[48px] min-h-[48px] ${
                activeTab === item.id
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <div className="w-5 h-5">{item.icon}</div>
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          ))}
          {/* More button */}
          <button
            onClick={() => setSheetOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg transition-smooth min-w-[48px] min-h-[48px] relative ${
              moreIsActive ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <div className="w-5 h-5">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
            </div>
            <span className="text-[10px] font-medium">More</span>
            {moreIsActive && (
              <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </button>
        </div>
      </nav>

      {/* Bottom sheet */}
      <MobileBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </>
  )
}

function MobileBottomSheet({ open, onClose, activeTab, setActiveTab }: {
  open: boolean
  onClose: () => void
  activeTab: string
  setActiveTab: (tab: string) => void
}) {
  // Track mount state for animation
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      // Mount first, then animate in on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open])

  // Handle close with animation
  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 200) // match transition duration
  }

  if (!open) return null

  return (
    <div className="md:hidden fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl max-h-[70vh] overflow-y-auto safe-area-bottom transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Grouped navigation */}
        <div className="px-4 pb-6">
          {navGroups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="my-3 border-t border-border" />}

              {/* Group header */}
              <div className="px-1 pt-1 pb-2">
                <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold">
                  {group.label || 'CORE'}
                </span>
              </div>

              {/* 2-column grid */}
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id)
                      handleClose()
                    }}
                    className={`flex items-center gap-2.5 px-3 min-h-[48px] rounded-xl transition-smooth ${
                      activeTab === item.id
                        ? 'bg-primary/15 text-primary'
                        : 'text-foreground hover:bg-secondary'
                    }`}
                  >
                    <div className="w-5 h-5 shrink-0">{item.icon}</div>
                    <span className="text-xs font-medium truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

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

function HistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8a7 7 0 1114 0A7 7 0 011 8z" />
      <path d="M8 4v4l3 2" />
      <path d="M1 8h2" />
    </svg>
  )
}

function AuditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" />
      <path d="M6 8l2 2 3-3" />
    </svg>
  )
}

function WebhookIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="11" cy="5" r="2.5" />
      <circle cx="8" cy="12" r="2.5" />
      <path d="M5 7.5v1c0 1.1.4 2 1.2 2.7" />
      <path d="M11 7.5v1c0 1.1-.4 2-1.2 2.7" />
    </svg>
  )
}

function GatewayConfigIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.5" cy="8" r="1" />
      <circle cx="10.5" cy="8" r="1" />
      <path d="M6.5 8h3" />
    </svg>
  )
}

function GatewaysIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="5" rx="1" />
      <rect x="1" y="9" width="14" height="5" rx="1" />
      <circle cx="4" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="4" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
      <path d="M7 4.5h5M7 11.5h5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
      <path d="M8 1v1" />
    </svg>
  )
}

function SuperAdminIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5l1.4 2.8 3.1.5-2.2 2.2.5 3.1L8 8.8 5.2 10l.5-3.1L3.5 4.8l3.1-.5L8 1.5z" />
      <path d="M2 13.5h12" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" />
    </svg>
  )
}
