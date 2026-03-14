'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { useNavigateToPanel, usePrefetchPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@/lib/version'
import { getPluginNavItems } from '@/lib/plugins'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  priority: boolean // Show in mobile bottom bar
  essential?: boolean // Visible in Essential interface mode (default false)
  children?: NavItem[] // Nested sub-items (expandable parent)
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
      { id: 'overview', label: 'Overview', icon: <OverviewIcon />, priority: true, essential: true },
      { id: 'agents', label: 'Agents', icon: <AgentsIcon />, priority: true, essential: true },
      { id: 'tasks', label: 'Tasks', icon: <TasksIcon />, priority: true, essential: true },
      { id: 'chat', label: 'Chat', icon: <ChatIcon />, priority: false, essential: true },
      { id: 'channels', label: 'Channels', icon: <ChannelsIcon />, priority: false },
      { id: 'skills', label: 'Skills', icon: <SkillsIcon />, priority: false },
      { id: 'memory', label: 'Memory', icon: <MemoryIcon />, priority: false },
    ],
  },
  {
    id: 'observe',
    label: 'OBSERVE',
    items: [
      { id: 'activity', label: 'Activity', icon: <ActivityIcon />, priority: true, essential: true },
      { id: 'logs', label: 'Logs', icon: <LogsIcon />, priority: false, essential: true },
      { id: 'cost-tracker', label: 'Cost Tracker', icon: <TokensIcon />, priority: false },
      { id: 'nodes', label: 'Nodes', icon: <NodesIcon />, priority: false },
      { id: 'exec-approvals', label: 'Approvals', icon: <ApprovalsIcon />, priority: false },
      { id: 'office', label: 'Office', icon: <OfficeIcon />, priority: false },
    ],
  },
  {
    id: 'automate',
    label: 'AUTOMATE',
    items: [
      { id: 'cron', label: 'Cron', icon: <CronIcon />, priority: false },
      { id: 'webhooks', label: 'Webhooks', icon: <WebhookIcon />, priority: false },
      { id: 'alerts', label: 'Alerts', icon: <AlertIcon />, priority: false },
      { id: 'github', label: 'GitHub', icon: <GitHubIcon />, priority: false },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    items: [
      { id: 'security', label: 'Security', icon: <SecurityIcon />, priority: false },
      { id: 'users', label: 'Users', icon: <UsersIcon />, priority: false },
      { id: 'audit', label: 'Audit', icon: <AuditIcon />, priority: false },
      {
        id: 'gateway-parent', label: 'Gateway', icon: <GatewaysIcon />, priority: false,
        children: [
          { id: 'gateways', label: 'Gateways', icon: <GatewaysIcon />, priority: false },
          { id: 'gateway-config', label: 'Config', icon: <GatewayConfigIcon />, priority: false },
        ],
      },
      { id: 'integrations', label: 'Integrations', icon: <IntegrationsIcon />, priority: false },
      { id: 'debug', label: 'Debug', icon: <DebugIcon />, priority: false },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon />, priority: false, essential: true },
    ],
  },
]

// Map nav item IDs to translation keys in the 'nav' namespace
const navItemTranslationKeys: Record<string, string> = {
  overview: 'overview',
  agents: 'agents',
  tasks: 'tasks',
  chat: 'chat',
  channels: 'channels',
  skills: 'skills',
  memory: 'memory',
  activity: 'activity',
  logs: 'logs',
  'cost-tracker': 'costTracker',
  nodes: 'nodes',
  'exec-approvals': 'approvals',
  office: 'office',
  cron: 'cron',
  webhooks: 'webhooks',
  alerts: 'alerts',
  github: 'github',
  security: 'security',
  users: 'users',
  audit: 'audit',
  'gateway-parent': 'gateway',
  gateways: 'gateways',
  'gateway-config': 'config',
  integrations: 'integrations',
  debug: 'debug',
  settings: 'settings',
}

// Map group IDs to translation keys in the 'nav.group' namespace
const groupTranslationKeys: Record<string, string> = {
  observe: 'observe',
  automate: 'automate',
  admin: 'admin',
}

const gatewayOnlyPanels = new Set([
  'gateways', 'gateway-config', 'channels', 'nodes', 'exec-approvals',
  ...getPluginNavItems().filter(pi => pi.gatewayOnly).map(pi => pi.id),
])
const adminOnlyPanels = new Set<string>([])

export function NavRail() {
  const { activeTab, connection, dashboardMode, currentUser, activeTenant, tenants, osUsers, setActiveTenant, fetchTenants, fetchOsUsers, activeProject, projects, setActiveProject, fetchProjects, sidebarExpanded, collapsedGroups, toggleSidebar, toggleGroup, defaultOrgName, interfaceMode, setInterfaceMode } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const prefetchPanel = usePrefetchPanel()
  const tn = useTranslations('nav')
  const tc = useTranslations('common')

  // Translate a nav item label using the translation key map
  function tLabel(id: string, fallback: string): string {
    const key = navItemTranslationKeys[id]
    return key ? tn(key) : fallback
  }
  function tGroup(id: string, fallback?: string): string | undefined {
    const key = groupTranslationKeys[id]
    return key ? tn(`group.${key}`) : fallback
  }
  const isLocal = dashboardMode === 'local'
  const isAdmin = currentUser?.role === 'admin'
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  function toggleParent(id: string) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Fetch tenants, OS users, and projects for admin users
  useEffect(() => {
    if (isAdmin) {
      fetchTenants()
      fetchOsUsers()
      fetchProjects()
    }
  }, [isAdmin, fetchTenants, fetchOsUsers, fetchProjects])

  // Re-fetch projects and clear active project when tenant changes
  useEffect(() => {
    if (isAdmin) {
      setActiveProject(null)
      fetchProjects()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant?.id])

  // In local mode, hide gateway-only panels. Non-admin users don't see admin-only panels.
  // In essential mode, hide non-essential panels.
  const isEssential = interfaceMode === 'essential'
  function filterItems(items: NavItem[]): NavItem[] {
    return items
      .map(i => {
        if (i.children) {
          const filteredChildren = filterItems(i.children)
          if (filteredChildren.length === 0) return null
          return { ...i, children: filteredChildren }
        }
        if (isLocal && gatewayOnlyPanels.has(i.id)) return null
        if (!isAdmin && adminOnlyPanels.has(i.id)) return null
        if (isEssential && !i.essential) return null
        return i
      })
      .filter((i): i is NavItem => i !== null)
  }
  // Translate nav item labels and merge plugin items
  function translateItems(items: NavItem[]): NavItem[] {
    return items.map(item => ({
      ...item,
      label: tLabel(item.id, item.label),
      children: item.children ? translateItems(item.children) : undefined,
    }))
  }
  const mergedGroups = navGroups.map(g => {
    const pluginItems = getPluginNavItems()
      .filter(pi => pi.groupId === g.id)
      .map(pi => ({
        id: pi.id,
        label: pi.label,
        icon: pi.icon ? <span>{pi.icon}</span> : <PluginIcon />,
        priority: false,
      } as NavItem))
    const items = translateItems(pluginItems.length > 0 ? [...g.items, ...pluginItems] : g.items)
    return { ...g, label: tGroup(g.id, g.label), items }
  })

  const filteredGroups = mergedGroups
    .map(g => ({ ...g, items: filterItems(g.items) }))
    .filter(g => g.items.length > 0)
  function flattenItems(items: NavItem[]): NavItem[] {
    return items.flatMap(i => i.children ? [i, ...flattenItems(i.children)] : [i])
  }
  const filteredAllNavItems = filteredGroups.flatMap(g => flattenItems(g.items))

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
        role="navigation"
        aria-label="Main navigation"
        className={`hidden md:flex flex-col bg-gradient-to-b from-card to-background border-r border-border shrink-0 transition-all duration-200 ease-in-out ${
          sidebarExpanded ? 'w-[220px]' : 'w-14'
        }`}
      >
        {/* Header: Logo + toggle */}
        <div className={`flex items-center shrink-0 ${sidebarExpanded ? 'px-3 py-3 gap-2.5' : 'flex-col py-3 gap-2'}`}>
          <div className="w-9 h-9 rounded-lg overflow-hidden bg-background border border-border/50 flex items-center justify-center shrink-0 hover:border-void-cyan/40 hover:glow-cyan transition-smooth">
            <Image
              src="/brand/mc-logo-128.png"
              alt="Mission Control logo"
              width={36}
              height={36}
              className="w-full h-full object-cover"
            />
          </div>
          {sidebarExpanded && (
            <div className="flex items-baseline gap-2 truncate flex-1 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">Mission Control</span>
              <span className="text-2xs text-muted-foreground font-mono-tight shrink-0">v{APP_VERSION}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleSidebar}
            title={sidebarExpanded ? tn('collapseSidebar') : tn('expandSidebar')}
            className="shrink-0"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              {sidebarExpanded ? (
                <polyline points="10,3 5,8 10,13" />
              ) : (
                <polyline points="6,3 11,8 6,13" />
              )}
            </svg>
          </Button>
        </div>

        {/* Nav groups */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          {filteredGroups.map((group, groupIndex) => (
            <div key={group.id}>
              {/* Divider between groups (not before first) */}
              {groupIndex > 0 && (
                <div className={`my-1.5 border-t border-border ${sidebarExpanded ? 'mx-3' : 'mx-2'}`} />
              )}

              {/* Group header (expanded mode, only for groups with labels) */}
              {sidebarExpanded && group.label && (
                <Button
                  variant="ghost"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 mt-3 mb-1 h-auto py-0 rounded-none hover:bg-transparent group/header"
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
                </Button>
              )}

              {/* Group items */}
              <div
                className={`overflow-hidden transition-all duration-150 ease-in-out ${
                  sidebarExpanded && collapsedGroups.includes(group.id) ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
                }`}
              >
                <div className={`flex flex-col ${sidebarExpanded ? 'gap-0.5 px-2' : 'items-center gap-1'}`}>
                  {group.items.map((item) => {
                    if (item.children) {
                      const isParentExpanded = expandedParents.has(item.id)
                      const childActive = item.children.some(c => activeTab === c.id)
                      if (!sidebarExpanded) {
                        // Collapsed mode: clicking parent navigates to first child
                        return (
                          <NavButton
                            key={item.id}
                            item={item}
                            active={childActive}
                            expanded={false}
                            onClick={() => navigateToPanel(item.children![0].id)}
                            onPrefetch={() => item.children?.forEach(child => prefetchPanel(child.id))}
                          />
                        )
                      }
                      return (
                        <div key={item.id}>
                          <div className="flex items-center w-full">
                            <Button
                              variant="ghost"
                              onClick={() => { navigateToPanel(item.id); if (!isParentExpanded) toggleParent(item.id) }}
                              onMouseEnter={() => { prefetchPanel(item.id); item.children?.forEach(child => prefetchPanel(child.id)) }}
                              onFocus={() => item.children?.forEach(child => prefetchPanel(child.id))}
                              className={`flex-1 flex items-center gap-2 px-2 py-1.5 h-auto rounded-lg rounded-r-none text-left justify-start relative ${
                                activeTab === item.id
                                  ? 'bg-primary/15 text-primary hover:bg-primary/20'
                                  : childActive && !isParentExpanded
                                    ? 'bg-primary/10 text-primary/80 hover:bg-primary/15'
                                    : ''
                              }`}
                            >
                              {activeTab === item.id && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r-full" />
                              )}
                              <div className="w-5 h-5 shrink-0">{item.icon}</div>
                              <span className="text-sm truncate flex-1">{item.label}</span>
                            </Button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleParent(item.id) }}
                              className="px-1.5 py-1.5 rounded-r-lg hover:bg-secondary/50 transition-colors"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`w-3 h-3 shrink-0 text-muted-foreground/40 transition-transform duration-150 ${
                                  isParentExpanded ? '' : '-rotate-90'
                                }`}
                              >
                                <polyline points="4,6 8,10 12,6" />
                              </svg>
                            </button>
                          </div>
                          <div
                            className={`overflow-hidden transition-all duration-150 ease-in-out ${
                              isParentExpanded ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'
                            }`}
                          >
                            <div className="flex flex-col gap-0.5 pl-4 mt-0.5">
                              {item.children.map(child => (
                                <NavButton
                                  key={child.id}
                                  item={child}
                                  active={activeTab === child.id}
                                  expanded={true}
                                  onClick={() => navigateToPanel(child.id)}
                                  onPrefetch={() => prefetchPanel(child.id)}
                                  nested
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <NavButton
                        key={item.id}
                        item={item}
                        active={activeTab === item.id}
                        expanded={sidebarExpanded}
                        onClick={() => navigateToPanel(item.id)}
                        onPrefetch={() => prefetchPanel(item.id)}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Promo banners */}
        {sidebarExpanded && (
          <div className="px-2 pb-2 space-y-2 shrink-0">
            <a
              href="https://x.com/nyk_builderz/status/2022996371922649192?s=20"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border/50 bg-surface-1 hover:bg-surface-2 hover:border-primary/30 transition-all duration-200 p-2 group"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-2xs font-semibold text-foreground group-hover:text-primary transition-colors">xint</span>
                <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary font-mono">CLI</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-snug">X power tools for agents.</p>
            </a>
            <a
              href="https://builderz.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-void-cyan/20 bg-gradient-to-br from-void-cyan/5 to-transparent hover:from-void-cyan/10 hover:border-void-cyan/40 transition-all duration-200 p-2 group"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-2xs font-bold text-foreground group-hover:text-void-cyan transition-colors">builderz</span>
                <span className="text-[9px] px-1 py-px rounded bg-void-cyan/15 text-void-cyan">.dev</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-snug">AI-native dev shop · Solana experts.</p>
            </a>
          </div>
        )}

        {/* Context switcher (profile-style, bottom of sidebar) */}
        <ContextSwitcher
          currentUser={currentUser}
          isAdmin={isAdmin}
          isLocal={isLocal}
          isConnected={connection.isConnected}
          tenants={tenants}
          osUsers={osUsers}
          activeTenant={activeTenant}
          onSwitchTenant={setActiveTenant}
          projects={projects}
          activeProject={activeProject}
          onSwitchProject={setActiveProject}
          expanded={sidebarExpanded}
          defaultOrgName={defaultOrgName}
          navigateToPanel={navigateToPanel}
          fetchTenants={fetchTenants}
          fetchOsUsers={fetchOsUsers}
          interfaceMode={interfaceMode}
          setInterfaceMode={setInterfaceMode}
          activeTab={activeTab}
        />
      </nav>

      {/* Mobile: Bottom tab bar */}
      <MobileBottomBar activeTab={activeTab} navigateToPanel={navigateToPanel} groups={filteredGroups} items={filteredAllNavItems} />
    </>
  )
}

function NavButton({ item, active, expanded, onClick, onPrefetch, nested }: {
  item: NavItem
  active: boolean
  expanded: boolean
  onClick: () => void
  onPrefetch?: () => void
  nested?: boolean
}) {
  if (expanded) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center gap-2 px-2 h-auto rounded-lg text-left justify-start relative ${
          nested ? 'py-1' : 'py-1.5'
        } ${
          active
            ? 'bg-primary/15 text-primary hover:bg-primary/20'
            : ''
        }`}
      >
        {active && (
          <span className="absolute left-0 w-0.5 h-5 bg-void-cyan rounded-r glow-cyan" />
        )}
        <div className={`shrink-0 ${nested ? 'w-4 h-4' : 'w-5 h-5'}`}>{item.icon}</div>
        <span className={`truncate ${nested ? 'text-xs' : 'text-sm'}`}>{item.label}</span>
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg group relative ${
        active
          ? 'bg-primary/15 text-primary hover:bg-primary/20'
          : ''
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
    </Button>
  )
}

function MobileBottomBar({ activeTab, navigateToPanel, groups, items }: {
  activeTab: string
  navigateToPanel: (tab: string) => void
  groups: NavGroup[]
  items: NavItem[]
}) {
  const tn = useTranslations('nav')
  const [sheetOpen, setSheetOpen] = useState(false)
  const priorityItems = items.filter(i => i.priority)
  const nonPriorityIds = new Set(items.filter(i => !i.priority).map(i => i.id))
  const moreIsActive = nonPriorityIds.has(activeTab)

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-area-bottom">
        <div className="flex items-center justify-around px-1 h-14">
          {priorityItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => navigateToPanel(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg min-w-[48px] min-h-[48px] h-auto ${
                activeTab === item.id
                  ? 'text-primary hover:text-primary'
                  : ''
              }`}
            >
              <div className="w-5 h-5">{item.icon}</div>
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </Button>
          ))}
          {/* More button */}
          <Button
            variant="ghost"
            onClick={() => setSheetOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg min-w-[48px] min-h-[48px] h-auto relative ${
              moreIsActive ? 'text-primary hover:text-primary' : ''
            }`}
          >
            <div className="w-5 h-5">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
            </div>
            <span className="text-[10px] font-medium">{tn('more')}</span>
            {moreIsActive && (
              <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </div>
      </nav>

      {/* Bottom sheet */}
      <MobileBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        activeTab={activeTab}
        navigateToPanel={navigateToPanel}
        groups={groups}
      />
    </>
  )
}

function MobileBottomSheet({ open, onClose, activeTab, navigateToPanel, groups }: {
  open: boolean
  onClose: () => void
  activeTab: string
  navigateToPanel: (tab: string) => void
  groups: NavGroup[]
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
        className={`absolute bottom-0 left-0 right-0 bg-card rounded-t-lg max-h-[70vh] overflow-y-auto safe-area-bottom transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Grouped navigation */}
        <div className="px-4 pb-6">
          {groups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="my-3 border-t border-border" />}

              {/* Group header */}
              <div className="px-1 pt-1 pb-2">
                <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold">
                  {group.label || 'CORE'}
                </span>
              </div>

              {/* 2-column grid — flatten nested children for mobile */}
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.flatMap(item => item.children ? item.children : [item]).map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => {
                      navigateToPanel(item.id)
                      handleClose()
                    }}
                    className={`flex items-center gap-2.5 px-3 min-h-[48px] h-auto rounded-lg justify-start ${
                      activeTab === item.id
                        ? 'bg-primary/15 text-primary hover:bg-primary/20'
                        : 'text-foreground'
                    }`}
                  >
                    <div className="w-5 h-5 shrink-0">{item.icon}</div>
                    <span className="text-xs font-medium truncate">{item.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Org row with collapsible nested projects (only shown for the active org) */
function OrgRow({ label, initial, active, colorClass, onClick, isActiveOrg, projects, activeProject, onSwitchProject, onNewProject }: {
  label: string
  initial: string
  active: boolean
  colorClass: string
  onClick: () => void
  isActiveOrg: boolean
  projects: import('@/store').Project[]
  activeProject: import('@/store').Project | null
  onSwitchProject: (project: import('@/store').Project | null) => void
  onNewProject: () => void
}) {
  const tcs = useTranslations('contextSwitcher')
  return (
    <div>
      <Button
        variant="ghost"
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start ${
          active ? 'text-primary bg-primary/10 hover:bg-primary/15' : 'text-foreground'
        }`}
      >
        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${colorClass}`}>{initial}</div>
        <span className="truncate">{label}</span>
        {isActiveOrg && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0 ml-auto text-muted-foreground/40">
            <polyline points="4,6 8,10 12,6" />
          </svg>
        )}
      </Button>
      {/* Nested projects for active org */}
      {isActiveOrg && (
        <div className="pl-4 mt-0.5 mb-1">
          <Button
            variant="ghost"
            onClick={() => onSwitchProject(null)}
            className={`w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start ${
              !activeProject ? 'text-primary bg-primary/5 hover:bg-primary/10' : ''
            }`}
          >
            <div className="w-4 h-4 rounded bg-muted-foreground/10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5 text-muted-foreground">
                <circle cx="8" cy="8" r="2" />
              </svg>
            </div>
            {tcs('all')}
          </Button>
          {projects.map((project) => (
            <Button
              key={project.id}
              variant="ghost"
              onClick={() => onSwitchProject(project)}
              className={`w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start ${
                activeProject?.id === project.id ? 'text-primary bg-primary/5 hover:bg-primary/10' : 'text-foreground hover:bg-secondary/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold shrink-0 ${
                  !project.color ? (project.status === 'active' ? 'bg-blue-500/20 text-blue-400' : 'bg-muted-foreground/10 text-muted-foreground') : ''
                }`}
                style={project.color ? { backgroundColor: `${project.color}33`, color: project.color } : undefined}
              >{project.ticket_prefix?.slice(0, 2) || project.name?.[0]?.toUpperCase() || 'P'}</div>
              <span className="truncate">{project.name}</span>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {typeof project.task_count === 'number' && project.task_count > 0 && (
                  <span className="text-[9px] bg-white/10 px-1 rounded text-muted-foreground/50">{project.task_count}</span>
                )}
                {project.deadline && project.deadline < Math.floor(Date.now() / 1000) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Overdue" />
                )}
                <span className="text-muted-foreground/30 text-[10px]">{project.ticket_prefix}</span>
              </div>
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={onNewProject}
            className="w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start"
          >
            <div className="w-4 h-4 flex items-center justify-center text-muted-foreground/50">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </div>
            New project...
          </Button>
        </div>
      )}
    </div>
  )
}

function ContextSwitcher({ currentUser, isAdmin, isLocal, isConnected, tenants, osUsers, activeTenant, onSwitchTenant, projects, activeProject, onSwitchProject, expanded, defaultOrgName, navigateToPanel, fetchTenants, fetchOsUsers, interfaceMode, setInterfaceMode, activeTab }: {
  currentUser: import('@/store').CurrentUser | null
  isAdmin: boolean
  isLocal: boolean
  isConnected: boolean
  tenants: import('@/store').Tenant[]
  osUsers: import('@/store').OsUser[]
  activeTenant: import('@/store').Tenant | null
  onSwitchTenant: (tenant: import('@/store').Tenant | null) => void
  projects: import('@/store').Project[]
  activeProject: import('@/store').Project | null
  onSwitchProject: (project: import('@/store').Project | null) => void
  expanded: boolean
  defaultOrgName: string
  navigateToPanel: (panel: string) => void
  fetchTenants: () => Promise<void>
  fetchOsUsers: () => Promise<void>
  interfaceMode: 'essential' | 'full'
  setInterfaceMode: (mode: 'essential' | 'full') => void
  activeTab: string
}) {
  const { setShowProjectManagerModal } = useMissionControl()
  const tcs = useTranslations('contextSwitcher')
  const tn = useTranslations('nav')
  const tc = useTranslations('common')
  // Build unified org list: DB tenants + unlinked OS users
  const linkedUsernames = new Set(tenants.map(t => t.linux_user))
  const unlinkedOsUsers = osUsers.filter(u => !linkedUsernames.has(u.username) && !u.is_process_owner)
  const [open, setOpen] = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', display_name: '', gateway_port: '', install_openclaw: true, install_claude: false, install_codex: false })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const userName = currentUser?.display_name || currentUser?.username || 'User'
  const initials = userName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const tenantName = activeTenant?.display_name || defaultOrgName
  const projectName = activeProject?.name
  const contextLine = projectName ? `${tenantName} / ${projectName}` : tenantName
  const connectionLabel = isLocal ? tcs('localMode') : isConnected ? tcs('connected') : tcs('disconnected')
  const connectionDotClass = isLocal ? 'bg-void-cyan' : isConnected ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className={`shrink-0 relative ${expanded ? 'px-3 pb-3' : 'flex flex-col items-center pb-3'}`}>
      {/* Trigger */}
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        title={expanded ? undefined : `${userName} · ${contextLine} · ${connectionLabel}`}
        className={`flex items-center rounded-lg ${
          expanded
            ? 'w-full gap-2.5 px-2.5 py-2 h-auto hover:bg-secondary/80 border border-transparent hover:border-border justify-start'
            : 'w-10 h-10 hover:bg-secondary group'
        }`}
      >
        {/* Avatar */}
        <div className={`shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold relative ${
          expanded ? 'w-8 h-8' : 'w-8 h-8'
        } ${currentUser?.avatar_url ? '' : 'bg-primary/20 text-primary'}`}>
          {currentUser?.avatar_url ? (
            <Image
              src={currentUser.avatar_url}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            initials
          )}
          {/* Connection dot on avatar */}
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${connectionDotClass}`} />
        </div>

        {expanded && (
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium text-foreground truncate leading-tight">{userName}</div>
            <div className="text-[11px] text-muted-foreground truncate leading-tight">{contextLine}</div>
          </div>
        )}

        {expanded && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50">
            <polyline points="4,10 8,6 12,10" />
          </svg>
        )}

        {/* Collapsed tooltip */}
        {!expanded && (
          <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover text-popover-foreground border border-border rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
            {userName}
          </span>
        )}
      </Button>

      {/* Popover (opens upward) */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 bg-popover border border-border rounded-lg shadow-xl min-w-[220px] max-h-[400px] overflow-y-auto ${
            expanded ? 'bottom-full mb-1 left-3 right-3' : 'bottom-full mb-1 left-1'
          }`}>
            {/* User info header */}
            <div className="px-3 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                  currentUser?.avatar_url ? '' : 'bg-primary/20 text-primary'
                }`}>
                  {currentUser?.avatar_url ? (
                    <Image
                      src={currentUser.avatar_url}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{userName}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{currentUser?.role || 'user'}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className={`flex items-center gap-1`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${connectionDotClass}`} />
                      {connectionLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interface mode toggle */}
            <div className="mx-2 border-t border-border my-1" />
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{tcs('interface')}</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={async () => {
                    if (interfaceMode === 'essential') return
                    setInterfaceMode('essential')
                    const essentialIds = new Set(['overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings'])
                    if (!essentialIds.has(activeTab)) navigateToPanel('overview')
                    try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'essential' } }) }) } catch {}
                  }}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                    interfaceMode === 'essential'
                      ? 'bg-void-amber/15 text-void-amber'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${interfaceMode === 'essential' ? 'bg-void-amber' : 'bg-muted-foreground/30'}`} />
                  {tcs('essential')}
                </button>
                <button
                  onClick={async () => {
                    if (interfaceMode === 'full') return
                    setInterfaceMode('full')
                    try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }) }) } catch {}
                  }}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors border-l border-border ${
                    interfaceMode === 'full'
                      ? 'bg-void-cyan/15 text-void-cyan'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${interfaceMode === 'full' ? 'bg-void-cyan' : 'bg-muted-foreground/30'}`} />
                  {tcs('full')}
                </button>
              </div>
            </div>

            {/* Quick navigation */}
            <div className="mx-2 border-t border-border my-1" />
            <div className="px-1 py-0.5">
              <Button
                variant="ghost"
                onClick={() => { navigateToPanel('settings'); setOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60">
                  <circle cx="8" cy="8" r="3" />
                  <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" />
                </svg>
                {tn('settings')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => { navigateToPanel('activity'); setOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60">
                  <path d="M14 8H11L9.5 13L6.5 3L5 8H2" />
                </svg>
                {tn('activity')}
              </Button>
            </div>

            {/* Organizations with nested projects (admin only, always visible) */}
            {isAdmin && (
              <>
                <div className="mx-2 border-t border-border my-1" />
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold">{tcs('organizations')}</span>
                </div>
                <div className="px-1">
                  {/* Default org */}
                  <OrgRow
                    label={defaultOrgName}
                    initial={defaultOrgName[0]?.toUpperCase() || 'D'}
                    active={!activeTenant}
                    colorClass="bg-void-cyan/20 text-void-cyan"
                    onClick={() => { onSwitchTenant(null); setOpen(false) }}
                    isActiveOrg={!activeTenant}
                    projects={projects}
                    activeProject={activeProject}
                    onSwitchProject={(p) => { onSwitchProject(p); setOpen(false) }}
                    onNewProject={() => { setShowProjectManagerModal(true); setOpen(false) }}
                  />
                  {/* DB tenants */}
                  {tenants.map((tenant) => (
                    <OrgRow
                      key={tenant.id}
                      label={tenant.display_name}
                      initial={tenant.display_name?.[0]?.toUpperCase() || 'T'}
                      active={activeTenant?.id === tenant.id}
                      colorClass={tenant.status === 'active' ? 'bg-green-500/20 text-green-400' : tenant.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}
                      onClick={() => { onSwitchTenant(tenant); setOpen(false) }}
                      isActiveOrg={activeTenant?.id === tenant.id}
                      projects={projects}
                      activeProject={activeProject}
                      onSwitchProject={(p) => { onSwitchProject(p); setOpen(false) }}
                      onNewProject={() => { setShowProjectManagerModal(true); setOpen(false) }}
                    />
                  ))}
                  {/* Discovered OS users not yet linked to a tenant — shown inline as unprovisioned orgs */}
                  {unlinkedOsUsers.map((osUser) => {
                    const hasTools = osUser.has_claude || osUser.has_codex
                    const disabled = isLocal && !hasTools
                    const tools = [
                      osUser.has_claude && 'claude',
                      osUser.has_codex && 'codex',
                      osUser.has_openclaw && 'openclaw',
                    ].filter(Boolean)
                    const statusLabel = isLocal
                      ? (tools.length > 0 ? tools.join('+') : tcs('noTools'))
                      : tcs('unlinked')
                    return (
                      <Button
                        key={osUser.username}
                        variant="ghost"
                        onClick={() => { if (!disabled) { navigateToPanel('super-admin'); setOpen(false) } }}
                        disabled={disabled}
                        title={disabled
                          ? `${osUser.username} — no claude or codex installed at ${osUser.home_dir}`
                          : `${osUser.home_dir} (uid ${osUser.uid}) — click to provision as organization`
                        }
                        className={`w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start ${
                          disabled
                            ? 'text-muted-foreground/30 cursor-not-allowed'
                            : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          disabled ? 'bg-muted-foreground/5 text-muted-foreground/30' : 'bg-muted-foreground/10 text-muted-foreground/60'
                        }`}>
                          {osUser.username[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="truncate">{osUser.username}</span>
                        <span className={`ml-auto text-[10px] shrink-0 ${disabled ? 'text-muted-foreground/20' : 'text-muted-foreground/30'}`}>{statusLabel}</span>
                      </Button>
                    )
                  })}
                </div>
                <div className="px-1 pb-1">
                  {!createMode ? (
                    <Button
                      variant="ghost"
                      disabled
                      title="Temporarily disabled — not functional yet"
                      className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start text-muted-foreground/40 cursor-not-allowed"
                    >
                      <div className="w-5 h-5 flex items-center justify-center text-muted-foreground/40">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                          <path d="M8 3v10M3 8h10" />
                        </svg>
                      </div>
                      {tcs('newOrganization')}
                    </Button>
                  ) : (
                    <div className="px-1 pt-1 pb-1 space-y-1.5">
                      <input
                        value={createForm.username}
                        onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
                        placeholder={tcs('usernamePlaceholder')}
                        autoFocus
                        className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                      />
                      <input
                        value={createForm.display_name}
                        onChange={(e) => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
                        placeholder={tcs('displayNamePlaceholder')}
                        className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                      />
                      {!isLocal && (
                        <input
                          value={createForm.gateway_port}
                          onChange={(e) => setCreateForm(f => ({ ...f, gateway_port: e.target.value }))}
                          placeholder={tcs('gatewayPortPlaceholder')}
                          className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                        />
                      )}
                      {/* Tool installation checkboxes */}
                      {isLocal && (
                        <div className="space-y-1 px-0.5">
                          <div className="text-[10px] text-muted-foreground/60 font-semibold tracking-wider">{tcs('installTools')}</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_openclaw: e.target.checked }))}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">openclaw</span>
                            </label>
                            <label className={`flex items-center gap-1 ${createForm.install_openclaw ? 'opacity-50' : ''} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={createForm.install_claude || createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_claude: e.target.checked }))}
                                disabled={createForm.install_openclaw}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">claude</span>
                              {createForm.install_openclaw && <span className="text-[9px] text-muted-foreground/50 italic">included</span>}
                            </label>
                            <label className={`flex items-center gap-1 ${createForm.install_openclaw ? 'opacity-50' : ''} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={createForm.install_codex || createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_codex: e.target.checked }))}
                                disabled={createForm.install_openclaw}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">codex</span>
                              {createForm.install_openclaw && <span className="text-[9px] text-muted-foreground/50 italic">included</span>}
                            </label>
                          </div>
                        </div>
                      )}
                      {createError && (
                        <div className="text-[10px] text-red-400 px-0.5">{createError}</div>
                      )}
                      <div className="flex gap-1.5">
                        <Button
                          size="xs"
                          disabled={creating}
                          onClick={async () => {
                            const username = createForm.username.trim().toLowerCase()
                            const display_name = createForm.display_name.trim()
                            if (!username || !display_name) { setCreateError(tcs('usernameAndDisplayRequired')); return }
                            if (!/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(username)) { setCreateError(tcs('invalidUsernameFormat')); return }
                            if (!isLocal && !createForm.gateway_port) { setCreateError(tcs('gatewayPortRequired')); return }
                            setCreating(true)
                            setCreateError(null)
                            try {
                              const res = await fetch('/api/super/os-users', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  username,
                                  display_name,
                                  gateway_mode: !isLocal,
                                  gateway_port: createForm.gateway_port ? Number(createForm.gateway_port) : undefined,
                                  install_openclaw: createForm.install_openclaw,
                                  install_claude: createForm.install_claude,
                                  install_codex: createForm.install_codex,
                                }),
                              })
                              const json = await res.json().catch(() => ({}))
                              if (!res.ok) throw new Error(json?.error || 'Failed to create organization')
                              setCreateForm({ username: '', display_name: '', gateway_port: '', install_openclaw: true, install_claude: false, install_codex: false })
                              setCreateMode(false)
                              await Promise.all([fetchTenants(), fetchOsUsers()])
                            } catch (e: any) {
                              setCreateError(e?.message || 'Failed to create')
                            } finally {
                              setCreating(false)
                            }
                          }}
                          className="flex-1 text-[11px]"
                        >
                          {creating ? tcs('creating') : isLocal ? tcs('createUser') : tcs('createAndQueue')}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => { setCreateMode(false); setCreateError(null) }}
                          className="text-[11px]"
                        >
                          {tc('cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
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

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M13 3H3a1 1 0 0 0-1 1v6l3-2h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
      <path d="M6 11v1a1 1 0 0 0 1 1h4l2 2v-4a1 1 0 0 0-1-1h-1" />
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

function IntegrationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 4h4M4 6v4M12 6v4M6 12h4" />
    </svg>
  )
}

function AgentCostsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-2.8 2.2-5 5-5" />
      <circle cx="12" cy="10" r="3.5" />
      <path d="M12 8.5v3M10.8 10h2.4" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 12.5c-3 1-3-1.5-4-2m8 4v-2.2a2.1 2.1 0 00-.6-1.6c2-.2 4.1-1 4.1-4.5a3.5 3.5 0 00-1-2.4 3.2 3.2 0 00-.1-2.4s-.8-.2-2.5 1a8.7 8.7 0 00-4.6 0C3.7 3.4 2.9 3.6 2.9 3.6a3.2 3.2 0 00-.1 2.4 3.5 3.5 0 00-1 2.4c0 3.5 2.1 4.3 4.1 4.5a2.1 2.1 0 00-.6 1.6v2.2" />
    </svg>
  )
}

function SkillsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

function SuperAdminIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" />
      <path d="M8 5v2M8 9v0.5" />
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

function OfficeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="10" rx="1" />
      <path d="M2 7h12" />
      <path d="M5 1v3M11 1v3" />
      <rect x="4" y="9" width="3" height="3" rx="0.5" />
      <rect x="9" y="9" width="3" height="3" rx="0.5" />
    </svg>
  )
}

function OrganizationsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="1" width="8" height="5" rx="1" />
      <rect x="1" y="10" width="5" height="5" rx="1" />
      <rect x="10" y="10" width="5" height="5" rx="1" />
      <path d="M8 6v2M4 10L8 8M12 10L8 8" />
    </svg>
  )
}

function ChannelsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4h14M1 8h14M1 12h14" />
      <circle cx="4" cy="4" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

function NodesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="10" y="1" width="5" height="5" rx="1" />
      <rect x="5.5" y="10" width="5" height="5" rx="1" />
      <path d="M6 3.5h4M3.5 6v4.5L5.5 12M12.5 6v4.5L10.5 12" />
    </svg>
  )
}

function ApprovalsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v4M4.5 3l2 2M11.5 3l-2 2" />
      <rect x="2" y="6" width="12" height="9" rx="1.5" />
      <path d="M5.5 10.5l2 2 3.5-4" />
    </svg>
  )
}

function DebugIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="9" r="5" />
      <path d="M8 4V1M3.5 6L1 4.5M12.5 6L15 4.5M3 9H1M15 9h-2M3.5 12L1 13.5M12.5 12L15 13.5" />
      <path d="M8 7v4M6 9h4" />
    </svg>
  )
}

function SecurityIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l6 3v4c0 3.5-2.5 6.5-6 7.5C4.5 14.5 2 11.5 2 8V4l6-3z" />
      <path d="M5.5 8l2 2 3.5-3.5" />
    </svg>
  )
}

function PluginIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v3M10 2v3M4 5h8a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
      <circle cx="8" cy="10" r="1.5" />
    </svg>
  )
}
