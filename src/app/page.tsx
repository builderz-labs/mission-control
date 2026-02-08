'use client'

import { useEffect, useState } from 'react'
import { Dashboard } from '@/components/dashboard/dashboard'
import { ConnectionStatus } from '@/components/hud/connection-status'
import { Sidebar } from '@/components/dashboard/sidebar'
import { AgentSpawnPanel } from '@/components/panels/agent-spawn-panel'
import { LogViewerPanel } from '@/components/panels/log-viewer-panel'
import { CronManagementPanel } from '@/components/panels/cron-management-panel'
import { MemoryBrowserPanel } from '@/components/panels/memory-browser-panel'
import { TokenDashboardPanel } from '@/components/panels/token-dashboard-panel'
import { SessionDetailsPanel } from '@/components/panels/session-details-panel'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'
import { ActivityFeedPanel } from '@/components/panels/activity-feed-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { StandupPanel } from '@/components/panels/standup-panel'
import { NotificationsPanel } from '@/components/panels/notifications-panel'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { DigitalClock } from '@/components/ui/digital-clock'
import { OnlineStatus } from '@/components/ui/online-status'
import { useWebSocket } from '@/lib/websocket'
import { useMissionControl } from '@/store'
import { ChatPanel } from '@/components/chat/chat-panel'

export default function Home() {
  const { isConnected, connect, disconnect, reconnect } = useWebSocket()
  const { activeTab, sidebarCollapsed, chatPanelOpen, setChatPanelOpen } = useMissionControl()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
    // Auto-connect on mount with auth token
    const wsToken = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || process.env.NEXT_PUBLIC_WS_TOKEN || ''
    const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
    // Use current hostname so it works from localhost AND Tailscale
    const gatewayHost = window.location.hostname
    const wsUrl = `ws://${gatewayHost}:${gatewayPort}`
    connect(wsUrl, wsToken)
  }, [connect])

  if (!isClient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-3 text-muted-foreground">Loading Mission Control...</span>
      </div>
    )
  }

  const renderMainContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Dashboard />
      case 'tasks':
        return <TaskBoardPanel />
      case 'agents':
        return <AgentSquadPanelPhase3 />
      case 'activity':
        return <ActivityFeedPanel />
      case 'notifications':
        return <NotificationsPanel />
      case 'standup':
        return <StandupPanel />
      case 'spawn':
        return <AgentSpawnPanel />
      case 'sessions':
        return <SessionDetailsPanel />
      case 'logs':
        return <LogViewerPanel />
      case 'cron':
        return <CronManagementPanel />
      case 'memory':
        return <MemoryBrowserPanel />
      case 'tokens':
        return <TokenDashboardPanel />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Enhanced Top Bar */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-4">
                <h1 className="text-2xl font-bold text-foreground">
                  Mission Control
                </h1>
                <div className="text-sm text-muted-foreground">
                  {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                </div>
              </div>
              
              {/* Digital Clock */}
              <DigitalClock />
            </div>

            <div className="flex items-center space-x-4">
              {/* Chat Toggle */}
              <button
                onClick={() => setChatPanelOpen(!chatPanelOpen)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  chatPanelOpen
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground hover:bg-secondary/80'
                }`}
              >
                💬 Chat
              </button>

              {/* Online Status */}
              <OnlineStatus isConnected={isConnected} />
              
              {/* Theme Toggle */}
              <ThemeToggle />
              
              {/* Connection Controls (smaller, less prominent) */}
              <div className="text-xs">
                <ConnectionStatus
                  isConnected={isConnected}
                  onConnect={() => {
                  const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
                  const gatewayHost = window.location.hostname
                  const wsUrl = `ws://${gatewayHost}:${gatewayPort}`
                  const wsToken = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || ''
                  connect(wsUrl, wsToken)
                }}
                  onDisconnect={disconnect}
                  onReconnect={reconnect}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {renderMainContent()}
        </main>
      </div>

      {/* Chat Panel Overlay */}
      <ChatPanel />
    </div>
  )
}
