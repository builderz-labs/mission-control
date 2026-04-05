'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel, usePrefetchPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@/lib/version'
import { getPluginNavItems } from '@/lib/plugins'
import { NavButton, type NavItemData } from '@/components/nav/nav-item'
import { MobileBottomBar } from '@/components/nav/mobile-nav'
import { ContextSwitcher } from '@/components/nav/context-switcher'
import {
  OverviewIcon, AgentsIcon, TasksIcon, ChatIcon, ChannelsIcon, SkillsIcon,
  MemoryIcon, ActivityIcon, LogsIcon, TokensIcon, NodesIcon, ApprovalsIcon,
  OfficeIcon, CronIcon, WebhookIcon, AlertIcon, GitHubIcon, SecurityIcon,
  UsersIcon, AuditIcon, GatewaysIcon, GatewayConfigIcon, IntegrationsIcon,
  DebugIcon, SettingsIcon, PluginIcon, JarvisIcon,
  NotificationsIcon, StandupIcon, DocumentsIcon, PipelineIcon,
  AgentHistoryIcon, SessionDetailsIcon, PresentationsIcon, TokenDashboardIcon,
  IntelBriefIcon, LeaderboardIcon,
  HandoffChainsIcon, ExecReplayIcon, ProviderFailoverIcon,
  WarRoomIcon, SearchIcon,
} from '@/components/nav/nav-icons'

interface NavGroup {
  id: string
  label?: string
  items: NavItemData[]
}

const navGroups: NavGroup[] = [
  {
    id: 'core',
    items: [
      { id: 'overview', label: 'Overview', icon: <OverviewIcon />, priority: true, essential: true },
      { id: 'agents', label: 'Agents', icon: <AgentsIcon />, priority: true, essential: true },
      { id: 'tasks', label: 'Tasks', icon: <TasksIcon />, priority: true, essential: true },
      { id: 'chat', label: 'Chat', icon: <ChatIcon />, priority: false, essential: true },
      { id: 'jarvis', label: 'JARVIS', icon: <JarvisIcon />, priority: true, essential: false },
      { id: 'channels', label: 'Channels', icon: <ChannelsIcon />, priority: false },
      { id: 'skills', label: 'Skills', icon: <SkillsIcon />, priority: false },
      { id: 'memory', label: 'Memory', icon: <MemoryIcon />, priority: false },
      { id: 'search', label: 'Search', icon: <SearchIcon />, priority: false },
    ],
  },
  {
    id: 'observe',
    label: 'OBSERVE',
    items: [
      { id: 'war-room', label: 'War Room', icon: <WarRoomIcon />, priority: true },
      { id: 'activity', label: 'Activity', icon: <ActivityIcon />, priority: true, essential: true },
      { id: 'logs', label: 'Logs', icon: <LogsIcon />, priority: false, essential: true },
      { id: 'cost-tracker', label: 'Cost Tracker', icon: <TokensIcon />, priority: false },
      { id: 'agent-cost', label: 'Agent Costs', icon: <TokensIcon />, priority: false },
      { id: 'token-dashboard', label: 'Token Analytics', icon: <TokenDashboardIcon />, priority: false },
      { id: 'notifications', label: 'Notifications', icon: <NotificationsIcon />, priority: false },
      { id: 'standup', label: 'Standup', icon: <StandupIcon />, priority: false },
      { id: 'agent-history', label: 'Agent History', icon: <AgentHistoryIcon />, priority: false },
      { id: 'intelligence-brief', label: 'Intel Brief', icon: <IntelBriefIcon />, priority: false },
      { id: 'leaderboard', label: 'Leaderboard', icon: <LeaderboardIcon />, priority: false },
      { id: 'exec-replay', label: 'Exec Replay', icon: <ExecReplayIcon />, priority: false },
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
      { id: 'pipeline', label: 'Pipelines', icon: <PipelineIcon />, priority: false },
      { id: 'webhooks', label: 'Webhooks', icon: <WebhookIcon />, priority: false },
      { id: 'alerts', label: 'Alerts', icon: <AlertIcon />, priority: false },
      { id: 'github', label: 'GitHub', icon: <GitHubIcon />, priority: false },
      { id: 'handoff-chains', label: 'Handoff Chains', icon: <HandoffChainsIcon />, priority: false },
    ],
  },
  {
    id: 'workspace',
    label: 'WORKSPACE',
    items: [
      { id: 'presentations', label: 'Presentations', icon: <PresentationsIcon />, priority: false },
      { id: 'documents', label: 'Documents', icon: <DocumentsIcon />, priority: false },
      { id: 'session-details', label: 'Session Details', icon: <SessionDetailsIcon />, priority: false },
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
      { id: 'providers', label: 'Providers', icon: <ProviderFailoverIcon />, priority: false },
      { id: 'debug', label: 'Debug', icon: <DebugIcon />, priority: false },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon />, priority: false, essential: true },
    ],
  },
]

const gatewayOnlyPanels = new Set([
  'gateways', 'gateway-config', 'channels', 'nodes', 'exec-approvals',
  ...getPluginNavItems().filter(pi => pi.gatewayOnly).map(pi => pi.id),
])
const adminOnlyPanels = new Set<string>([
  'security',
  'users',
  'audit',
  'gateways',
  'gateway-config',
  'gateway-parent',
  'integrations',
  'debug',
  'settings',
])

export function NavRail() {
  const {
    activeTab, connection, dashboardMode, currentUser, activeTenant, tenants,
    osUsers, setActiveTenant, fetchTenants, fetchOsUsers, activeProject, projects,
    setActiveProject, fetchProjects, sidebarExpanded, collapsedGroups, toggleSidebar,
    toggleGroup, defaultOrgName, interfaceMode, setInterfaceMode,
  } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const prefetchPanel = usePrefetchPanel()
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

  const isEssential = interfaceMode === 'essential'

  function filterItems(items: NavItemData[]): NavItemData[] {
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
      .filter((i): i is NavItemData => i !== null)
  }

  // Merge plugin nav items into groups by groupId
  const mergedGroups = navGroups.map(g => {
    const pluginItems = getPluginNavItems()
      .filter(pi => pi.groupId === g.id)
      .map(pi => ({
        id: pi.id,
        label: pi.label,
        icon: pi.icon ? <span>{pi.icon}</span> : <PluginIcon />,
        priority: false,
      } as NavItemData))
    if (pluginItems.length === 0) return g
    return { ...g, items: [...g.items, ...pluginItems] }
  })

  const filteredGroups = mergedGroups
    .map(g => ({ ...g, items: filterItems(g.items) }))
    .filter(g => g.items.length > 0)

  function flattenItems(items: NavItemData[]): NavItemData[] {
    return items.flatMap(i => i.children ? [i, ...flattenItems(i.children)] : [i])
  }
  const filteredAllNavItems = filteredGroups.flatMap(g => flattenItems(g.items))

  // Keyboard shortcut: [ to toggle sidebar
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === '[' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement)?.isContentEditable)
      ) {
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
              src="/brand/mantu-logo-128.png"
              onError={(e) => { (e.target as HTMLImageElement).src = '/brand/mc-logo-128.png' }}
              alt="Ultron Mission Control logo"
              width={36}
              height={36}
              className="w-full h-full object-cover"
            />
          </div>
          {sidebarExpanded && (
            <div className="flex items-baseline gap-2 truncate flex-1 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">Ultron Mission Control</span>
              <span className="text-2xs text-muted-foreground font-mono-tight shrink-0">v{APP_VERSION}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleSidebar}
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label="Toggle sidebar"
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
              {groupIndex > 0 && (
                <div className={`my-1.5 border-t border-border ${sidebarExpanded ? 'mx-3' : 'mx-2'}`} />
              )}

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

              <div
                className={`overflow-hidden transition-all duration-150 ease-in-out ${
                  sidebarExpanded && collapsedGroups.includes(group.id) ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
                }`}
              >
                <div className={`flex flex-col ${sidebarExpanded ? 'gap-0.5 px-2' : 'items-center gap-1'}`}>
                  {group.items.map((item) => {
                    if (item.children) {
                      return (
                        <ExpandableNavItem
                          key={item.id}
                          item={item}
                          activeTab={activeTab}
                          sidebarExpanded={sidebarExpanded}
                          isExpanded={expandedParents.has(item.id)}
                          onToggle={() => toggleParent(item.id)}
                          navigateToPanel={navigateToPanel}
                          prefetchPanel={prefetchPanel}
                        />
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

        {/* Creator card */}
        {sidebarExpanded && (
          <div className="px-2 pb-2 shrink-0">
            <a
              href="https://www.linkedin.com/in/tonywalteur/"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-white/[0.08] bg-gradient-to-br from-white/[0.04] to-transparent hover:from-white/[0.07] hover:border-white/[0.14] transition-all duration-200 p-2.5 group"
            >
              {/* Header row: brand + live dot */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs font-bold tracking-tight text-foreground/90 group-hover:text-foreground transition-colors">
                    Tony Walteur
                  </span>
                  <span className="text-[8px] font-mono px-1 py-px rounded bg-primary/15 text-primary border border-primary/20 leading-none">
                    AI
                  </span>
                </div>
                {/* Animated live indicator */}
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
              </div>

              {/* Byline */}
              <p className="text-[9px] text-muted-foreground/60 leading-snug mb-2">
                Built by <span className="text-muted-foreground/85 font-medium group-hover:text-primary transition-colors duration-200">Tony Walteur</span>
              </p>

              {/* Mini product chips */}
              <div className="flex flex-wrap gap-1">
                <span className="text-[8px] px-1.5 py-px rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 leading-none">
                  DictX · Beta
                </span>
                <span className="text-[8px] px-1.5 py-px rounded-sm bg-void-cyan/10 text-void-cyan/80 border border-void-cyan/20 leading-none">
                  Flight Deck · Soon
                </span>
              </div>
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
      <MobileBottomBar
        activeTab={activeTab}
        navigateToPanel={navigateToPanel}
        groups={filteredGroups}
        items={filteredAllNavItems}
      />
    </>
  )
}

interface ExpandableNavItemProps {
  item: NavItemData
  activeTab: string
  sidebarExpanded: boolean
  isExpanded: boolean
  onToggle: () => void
  navigateToPanel: (id: string) => void
  prefetchPanel: (id: string) => void
}

/** Renders a nav item that has nested children, with expand/collapse toggle. */
function ExpandableNavItem({
  item, activeTab, sidebarExpanded, isExpanded, onToggle, navigateToPanel, prefetchPanel,
}: ExpandableNavItemProps) {
  const childActive = item.children!.some(c => activeTab === c.id)

  if (!sidebarExpanded) {
    // Collapsed sidebar: clicking parent navigates to first child
    return (
      <NavButton
        item={item}
        active={childActive}
        expanded={false}
        onClick={() => navigateToPanel(item.children![0].id)}
        onPrefetch={() => item.children?.forEach(child => prefetchPanel(child.id))}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center w-full">
        <Button
          variant="ghost"
          onClick={() => { navigateToPanel(item.id); if (!isExpanded) onToggle() }}
          onMouseEnter={() => { prefetchPanel(item.id); item.children?.forEach(child => prefetchPanel(child.id)) }}
          onFocus={() => item.children?.forEach(child => prefetchPanel(child.id))}
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 h-auto rounded-lg rounded-r-none text-left justify-start relative ${
            activeTab === item.id
              ? 'bg-primary/15 text-primary hover:bg-primary/20'
              : childActive && !isExpanded
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
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label="Expand section"
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
              isExpanded ? '' : '-rotate-90'
            }`}
          >
            <polyline points="4,6 8,10 12,6" />
          </svg>
        </button>
      </div>
      <div
        className={`overflow-hidden transition-all duration-150 ease-in-out ${
          isExpanded ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex flex-col gap-0.5 pl-4 mt-0.5">
          {item.children!.map(child => (
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
