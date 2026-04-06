'use client'

// All panel-level code splitting lives here.  Keeping every dynamic() call in
// one place makes adding or removing a panel a single-file change, and keeps
// page.tsx focused on orchestration rather than import bookkeeping.
//
// NOTE: Turbopack requires dynamic() options to be an inline object literal —
// no variable references allowed, hence the repetition below.

import { createElement } from 'react'
import dynamic from 'next/dynamic'
import { Dashboard } from '@/components/dashboard/dashboard'
import { PanelSkeleton } from '@/components/ui/panel-skeleton'
import { getPluginPanel } from '@/lib/plugins'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'
import { useMissionControl } from '@/store'

// ---------------------------------------------------------------------------
// Lazy-loaded panels (code-split per route)
// ---------------------------------------------------------------------------

const LogViewerPanel = dynamic(
  () => import('@/components/panels/log-viewer-panel').then(m => ({ default: m.LogViewerPanel })),
  { loading: () => <PanelSkeleton /> },
)
const CronManagementPanel = dynamic(
  () => import('@/components/panels/cron-management-panel').then(m => ({ default: m.CronManagementPanel })),
  { loading: () => <PanelSkeleton /> },
)
const MemoryBrowserPanel = dynamic(
  () => import('@/components/panels/memory-browser-panel').then(m => ({ default: m.MemoryBrowserPanel })),
  { loading: () => <PanelSkeleton /> },
)
const CostTrackerPanel = dynamic(
  () => import('@/components/panels/cost-tracker-panel').then(m => ({ default: m.CostTrackerPanel })),
  { loading: () => <PanelSkeleton /> },
)
const TaskBoardPanel = dynamic(
  () => import('@/components/panels/task-board-panel').then(m => ({ default: m.TaskBoardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ActivityFeedPanel = dynamic(
  () => import('@/components/panels/activity-feed-panel').then(m => ({ default: m.ActivityFeedPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AgentSquadPanelPhase3 = dynamic(
  () => import('@/components/panels/agent-squad-panel-phase3').then(m => ({ default: m.AgentSquadPanelPhase3 })),
  { loading: () => <PanelSkeleton /> },
)
const AgentCommsPanel = dynamic(
  () => import('@/components/panels/agent-comms-panel').then(m => ({ default: m.AgentCommsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const StandupPanel = dynamic(
  () => import('@/components/panels/standup-panel').then(m => ({ default: m.StandupPanel })),
  { loading: () => <PanelSkeleton /> },
)
const OrchestrationBar = dynamic(
  () => import('@/components/panels/orchestration-bar').then(m => ({ default: m.OrchestrationBar })),
  { loading: () => <PanelSkeleton /> },
)
const NotificationsPanel = dynamic(
  () => import('@/components/panels/notifications-panel').then(m => ({ default: m.NotificationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const UserManagementPanel = dynamic(
  () => import('@/components/panels/user-management-panel').then(m => ({ default: m.UserManagementPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AuditTrailPanel = dynamic(
  () => import('@/components/panels/audit-trail-panel').then(m => ({ default: m.AuditTrailPanel })),
  { loading: () => <PanelSkeleton /> },
)
const WebhookPanel = dynamic(
  () => import('@/components/panels/webhook-panel').then(m => ({ default: m.WebhookPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SettingsPanel = dynamic(
  () => import('@/components/panels/settings-panel').then(m => ({ default: m.SettingsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const GatewayConfigPanel = dynamic(
  () => import('@/components/panels/gateway-config-panel').then(m => ({ default: m.GatewayConfigPanel })),
  { loading: () => <PanelSkeleton /> },
)
const IntegrationsPanel = dynamic(
  () => import('@/components/panels/integrations-panel').then(m => ({ default: m.IntegrationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AlertRulesPanel = dynamic(
  () => import('@/components/panels/alert-rules-panel').then(m => ({ default: m.AlertRulesPanel })),
  { loading: () => <PanelSkeleton /> },
)
const MultiGatewayPanel = dynamic(
  () => import('@/components/panels/multi-gateway-panel').then(m => ({ default: m.MultiGatewayPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SuperAdminPanel = dynamic(
  () => import('@/components/panels/super-admin-panel').then(m => ({ default: m.SuperAdminPanel })),
  { loading: () => <PanelSkeleton /> },
)
const OfficePanel = dynamic(
  () => import('@/components/panels/office-panel').then(m => ({ default: m.OfficePanel })),
  { loading: () => <PanelSkeleton /> },
)
const GitHubSyncPanel = dynamic(
  () => import('@/components/panels/github-sync-panel').then(m => ({ default: m.GitHubSyncPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SkillsPanel = dynamic(
  () => import('@/components/panels/skills-panel').then(m => ({ default: m.SkillsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const LocalAgentsDocPanel = dynamic(
  () => import('@/components/panels/local-agents-doc-panel').then(m => ({ default: m.LocalAgentsDocPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ChannelsPanel = dynamic(
  () => import('@/components/panels/channels-panel').then(m => ({ default: m.ChannelsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const DebugPanel = dynamic(
  () => import('@/components/panels/debug-panel').then(m => ({ default: m.DebugPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SecurityAuditPanel = dynamic(
  () => import('@/components/panels/security-audit-panel').then(m => ({ default: m.SecurityAuditPanel })),
  { loading: () => <PanelSkeleton /> },
)
const NodesPanel = dynamic(
  () => import('@/components/panels/nodes-panel').then(m => ({ default: m.NodesPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ExecApprovalPanel = dynamic(
  () => import('@/components/panels/exec-approval-panel').then(m => ({ default: m.ExecApprovalPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ChatPagePanel = dynamic(
  () => import('@/components/panels/chat-page-panel').then(m => ({ default: m.ChatPagePanel })),
  { loading: () => <PanelSkeleton /> },
)
const JarvisPanel = dynamic(
  () => import('@/components/panels/jarvis-panel').then(m => ({ default: m.JarvisPanel })),
  { loading: () => <PanelSkeleton /> },
)
const TokenDashboardPanel = dynamic(
  () => import('@/components/panels/token-dashboard-panel').then(m => ({ default: m.TokenDashboardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const PipelineTab = dynamic(
  () => import('@/components/panels/pipeline-tab').then(m => ({ default: m.PipelineTab })),
  { loading: () => <PanelSkeleton /> },
)
const AgentCostPanel = dynamic(
  () => import('@/components/panels/agent-cost-panel').then(m => ({ default: m.AgentCostPanel })),
  { loading: () => <PanelSkeleton /> },
)
const AgentHistoryPanel = dynamic(
  () => import('@/components/panels/agent-history-panel').then(m => ({ default: m.AgentHistoryPanel })),
  { loading: () => <PanelSkeleton /> },
)
const DocumentsPanel = dynamic(
  () => import('@/components/panels/documents-panel').then(m => ({ default: m.DocumentsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SessionDetailsPanel = dynamic(
  () => import('@/components/panels/session-details-panel').then(m => ({ default: m.SessionDetailsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const PresentationsPanel = dynamic(
  () => import('@/components/panels/presentations-panel').then(m => ({ default: m.PresentationsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const IntelligenceBriefPanel = dynamic(
  () => import('@/components/panels/intelligence-brief-panel').then(m => ({ default: m.IntelligenceBriefPanel })),
  { loading: () => <PanelSkeleton /> },
)
const LeaderboardPanel = dynamic(
  () => import('@/components/panels/leaderboard-panel').then(m => ({ default: m.LeaderboardPanel })),
  { loading: () => <PanelSkeleton /> },
)
const HandoffChainsPanel = dynamic(
  () => import('@/components/panels/handoff-chains-panel').then(m => ({ default: m.HandoffChainsPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ExecReplayPanel = dynamic(
  () => import('@/components/panels/exec-replay-panel').then(m => ({ default: m.ExecReplayPanel })),
  { loading: () => <PanelSkeleton /> },
)
const ProviderFailoverPanel = dynamic(
  () => import('@/components/panels/provider-failover-panel').then(m => ({ default: m.ProviderFailoverPanel })),
  { loading: () => <PanelSkeleton /> },
)
const WarRoomPanel = dynamic(
  () => import('@/components/panels/war-room-panel').then(m => ({ default: m.WarRoomPanel })),
  { loading: () => <PanelSkeleton /> },
)
const SemanticSearchPanel = dynamic(
  () => import('@/components/panels/semantic-search-panel').then(m => ({ default: m.SemanticSearchPanel })),
  { loading: () => <PanelSkeleton /> },
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Panels available in essential mode.  All others show an upgrade nudge.
export const ESSENTIAL_PANELS = new Set([
  'overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPluginPanel(panelId: string): React.ReactElement {
  const pluginPanel = getPluginPanel(panelId)
  return pluginPanel ? createElement(pluginPanel) : <Dashboard />
}

// ---------------------------------------------------------------------------
// LocalModeUnavailable
// ---------------------------------------------------------------------------

interface LocalModeUnavailableProps {
  readonly panel: string
}

function LocalModeUnavailable({ panel }: LocalModeUnavailableProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{panel}</span> requires an OpenClaw gateway connection.
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Configure a gateway to enable this panel.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContentRouter
// ---------------------------------------------------------------------------

interface ContentRouterProps {
  readonly tab: string
}

export function ContentRouter({ tab }: ContentRouterProps): React.ReactElement {
  const { dashboardMode, interfaceMode, setInterfaceMode } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'

  // Guard: panels outside the essential set are gated in essential mode.
  // Users can unlock by switching to full mode or navigating back to overview.
  if (interfaceMode === 'essential' && !ESSENTIAL_PANELS.has(tab)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground capitalize">{tab.replace(/-/g, ' ')}</span> is available in Full mode.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setInterfaceMode('full')
              try {
                await fetch('/api/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }),
                  signal: AbortSignal.timeout(8000),
                })
              } catch {
                // Best-effort persistence; UI already switched locally above
              }
            }}
          >
            Switch to Full
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigateToPanel('overview')}>
            Go to Overview
          </Button>
        </div>
      </div>
    )
  }

  switch (tab) {
    case 'overview':
      return (
        <>
          <Dashboard />
          {!isLocal && (
            <div className="mt-4 mx-4 mb-4 rounded-lg border border-border bg-card overflow-hidden">
              <AgentCommsPanel />
            </div>
          )}
        </>
      )
    case 'tasks':        return <TaskBoardPanel />
    case 'agents':
      return (
        <>
          <OrchestrationBar />
          {isLocal && <LocalAgentsDocPanel />}
          <AgentSquadPanelPhase3 />
        </>
      )
    case 'notifications':   return <NotificationsPanel />
    case 'standup':          return <StandupPanel />
    case 'sessions':         return <ChatPagePanel />
    case 'logs':             return <LogViewerPanel />
    case 'cron':             return <CronManagementPanel />
    case 'memory':           return <MemoryBrowserPanel />
    case 'cost-tracker':
    case 'tokens':
    case 'agent-costs':      return <CostTrackerPanel />
    case 'users':            return <UserManagementPanel />
    case 'history':
    case 'activity':         return <ActivityFeedPanel />
    case 'audit':            return <AuditTrailPanel />
    case 'webhooks':         return <WebhookPanel />
    case 'alerts':           return <AlertRulesPanel />
    case 'gateways':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <MultiGatewayPanel />
    case 'gateway-config':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <GatewayConfigPanel />
    case 'integrations':     return <IntegrationsPanel />
    case 'settings':         return <SettingsPanel />
    case 'super-admin':      return <SuperAdminPanel />
    case 'github':           return <GitHubSyncPanel />
    case 'office':           return <OfficePanel />
    case 'skills':           return <SkillsPanel />
    case 'channels':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <ChannelsPanel />
    case 'nodes':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <NodesPanel />
    case 'security':         return <SecurityAuditPanel />
    case 'debug':            return <DebugPanel />
    case 'exec-approvals':
      if (isLocal) return <LocalModeUnavailable panel={tab} />
      return <ExecApprovalPanel />
    case 'chat':             return <ChatPagePanel />
    case 'jarvis':           return <JarvisPanel />
    case 'token-dashboard':  return <TokenDashboardPanel />
    case 'pipeline':         return <PipelineTab />
    case 'agent-cost':       return <AgentCostPanel />
    case 'agent-history':    return <AgentHistoryPanel />
    case 'documents':        return <DocumentsPanel />
    case 'session-details':  return <SessionDetailsPanel />
    case 'presentations':    return <PresentationsPanel />
    case 'intelligence-brief': return <IntelligenceBriefPanel />
    case 'leaderboard':      return <LeaderboardPanel />
    case 'handoff-chains':   return <HandoffChainsPanel />
    case 'exec-replay':      return <ExecReplayPanel />
    case 'providers':        return <ProviderFailoverPanel />
    case 'war-room':         return <WarRoomPanel />
    case 'search':           return <SemanticSearchPanel />
    default:                 return renderPluginPanel(tab)
  }
}
