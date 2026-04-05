'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { useWebSocket } from '@/lib/websocket'
import { useNavigateToPanel, usePrefetchPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ui/theme-selector'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { DigitalClock } from '@/components/ui/digital-clock'
import { ModeBadge } from './mode-badge'
import { Stat, NavigationLatencyStat, SseBadge, SearchIcon, BellIcon } from './header-bar-stats'
import { CommandPalette } from './command-palette'
import { useCommandSearch } from './use-command-search'

export function HeaderBar(): React.ReactElement {
  const { connection, sessions, unreadNotificationCount, activeTenant, activeProject } = useMissionControl()
  const { reconnect } = useWebSocket()
  const navigateToPanel = useNavigateToPanel()
  const prefetchPanel = usePrefetchPanel()
  const th = useTranslations('header')
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const activeSessions = sessions.filter(s => s.active).length

  const {
    searchOpen,
    searchQuery,
    searchResults,
    searchLoading,
    selectedIndex,
    searchRef,
    searchInputRef,
    resultButtonRefs,
    openCommandPalette,
    handleSearchInput,
    handleResultClick,
    setSearchOpen,
    setSelectedIndex,
  } = useCommandSearch()

  return (
    <header role="banner" aria-label="Application header" className="relative z-50 h-14 bg-card/80 backdrop-blur-sm border-b border-border px-3 md:px-4 shrink-0">
      <div className="h-full flex items-center gap-2 md:gap-3">
        {/* Left: Page title + context */}
        <div className="flex min-w-0 items-center gap-2.5 shrink-0">
          <ProjectContext
            activeProject={activeProject}
            activeTenant={activeTenant}
            navigateToPanel={navigateToPanel}
            prefetchPanel={prefetchPanel}
            th={th}
          />
          <ModeBadge connection={connection} onReconnect={reconnect} />
        </div>

        {/* Center: wide command search (desktop) */}
        <div className="hidden md:flex items-center justify-center flex-1 min-w-0 max-w-[28rem] lg:max-w-[34rem] xl:max-w-[42rem]">
          <Button
            variant="outline"
            size="sm"
            onClick={openCommandPalette}
            className="h-10 w-full justify-between bg-secondary/35 hover:border-primary/40 hover:bg-secondary/50 px-3"
          >
            <span className="flex items-center gap-2 min-w-0">
              <SearchIcon />
              <span className="truncate text-sm text-muted-foreground">{th('jumpToSearch')}</span>
            </span>
            <span className="hidden xl:flex items-center gap-1 ml-2 shrink-0">
              <kbd className="text-2xs px-1.5 py-0.5 rounded bg-muted border border-border font-mono">&#8984;K</kbd>
              <kbd className="text-2xs px-1.5 py-0.5 rounded bg-muted border border-border font-mono">/</kbd>
            </span>
          </Button>
        </div>

        {/* Right: status + actions */}
        <div className="flex items-center justify-end gap-1.5 md:gap-2 min-w-0 shrink-0 ml-auto">
          <div className="hidden xl:flex items-center gap-3">
            <Stat label={th('sessions')} value={`${activeSessions}/${sessions.length}`} />
            <NavigationLatencyStat />
            <SseBadge connected={connection.sseConnected ?? false} />
            <DigitalClock />
          </div>

          {/* Mobile search trigger */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openCommandPalette}
            className="md:hidden"
            title="Search"
            aria-label="Search"
          >
            <SearchIcon />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigateToPanel('notifications')}
            onMouseEnter={() => prefetchPanel('notifications')}
            onFocus={() => prefetchPanel('notifications')}
            className="relative"
            aria-label="Notifications"
          >
            <BellIcon />
            {unreadNotificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-2xs flex items-center justify-center font-medium">
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
          </Button>

          <LanguageSwitcher />
          <ThemeSelector />
        </div>
      </div>

      {/* Search overlay (portal to body to avoid clipping/stacking context bugs) */}
      {searchOpen && isMounted && createPortal(
        <CommandPalette
          searchRef={searchRef}
          searchInputRef={searchInputRef}
          resultButtonRefs={resultButtonRefs}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searchLoading={searchLoading}
          selectedIndex={selectedIndex}
          onSearchInput={handleSearchInput}
          onResultClick={handleResultClick}
          onClose={() => setSearchOpen(false)}
          onHoverResult={setSelectedIndex}
        />,
        document.body,
      )}
    </header>
  )
}

interface ProjectContextProps {
  activeProject: { name: string } | null | undefined
  activeTenant: { display_name: string } | null | undefined
  navigateToPanel: (panel: string) => void
  prefetchPanel: (panel: string) => void
  th: ReturnType<typeof useTranslations<'header'>>
}

function ProjectContext({
  activeProject,
  activeTenant,
  navigateToPanel,
  prefetchPanel,
  th,
}: ProjectContextProps): React.ReactElement | null {
  if (activeProject) {
    return (
      <Button
        variant="outline"
        size="xs"
        onClick={() => navigateToPanel('tasks')}
        onMouseEnter={() => prefetchPanel('tasks')}
        onFocus={() => prefetchPanel('tasks')}
        className="hidden lg:flex items-center gap-1 text-2xs bg-secondary/50 min-w-0 max-w-[320px]"
        title={`Scoped to project: ${activeProject.name}`}
      >
        <span className="text-muted-foreground/60 truncate">{activeTenant?.display_name || 'Default'}</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground truncate">{activeProject.name}</span>
      </Button>
    )
  }
  if (activeTenant) {
    return (
      <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/40 text-2xs">
        <span className="text-muted-foreground">{th('workspace')}</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground truncate max-w-[220px]">{activeTenant.display_name}</span>
      </div>
    )
  }
  return null
}
