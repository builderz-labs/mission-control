'use client'

import { createElement, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Dashboard } from '@/components/dashboard/dashboard'
import { ChatPagePanel } from '@/components/panels/chat-page-panel'
import { ActivityFeedPanel } from '@/components/panels/activity-feed-panel'
import { AgentCommsPanel } from '@/components/panels/agent-comms-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { AlertRulesPanel } from '@/components/panels/alert-rules-panel'
import { AuditTrailPanel } from '@/components/panels/audit-trail-panel'
import { ChannelsPanel } from '@/components/panels/channels-panel'
import { CostTrackerPanel } from '@/components/panels/cost-tracker-panel'
import { CronManagementPanel } from '@/components/panels/cron-management-panel'
import { DebugPanel } from '@/components/panels/debug-panel'
import { ExecApprovalPanel } from '@/components/panels/exec-approval-panel'
import { FlyOrchestrationPanel } from '@/components/panels/fly-orchestration-panel'
import { FullModeRequired } from '@/components/panels/full-mode-required'
import { GatewayConfigPanel } from '@/components/panels/gateway-config-panel'
import { GatewayControlPanel } from '@/components/panels/gateway-control-panel'
import { GitHubSyncPanel } from '@/components/panels/github-sync-panel'
import { IntegrationsPanel } from '@/components/panels/integrations-panel'
import { LocalAgentsDocPanel } from '@/components/panels/local-agents-doc-panel'
import { LogViewerPanel } from '@/components/panels/log-viewer-panel'
import { MemoryBrowserPanel } from '@/components/panels/memory-browser-panel'
import { MultiGatewayPanel } from '@/components/panels/multi-gateway-panel'
import { NodesPanel } from '@/components/panels/nodes-panel'
import { NotificationsPanel } from '@/components/panels/notifications-panel'
import { OfficePanel } from '@/components/panels/office-panel'
import { OrchestrationBar } from '@/components/panels/orchestration-bar'
import { SecurityAuditPanel } from '@/components/panels/security-audit-panel'
import { SettingsPanel } from '@/components/panels/settings-panel'
import { SkillsPanel } from '@/components/panels/skills-panel'
import { StandupPanel } from '@/components/panels/standup-panel'
import { SuperAdminPanel } from '@/components/panels/super-admin-panel'
import { SystemMonitorPanel } from '@/components/panels/system-monitor-panel'
import { TaskBoardPanel } from '@/components/panels/task-board-panel'
import { UnknownPanel } from '@/components/panels/unknown-panel'
import { UserManagementPanel } from '@/components/panels/user-management-panel'
import { WebhookPanel } from '@/components/panels/webhook-panel'
import { getPluginPanel } from '@/lib/plugins'
import { useMissionControl } from '@/store'
import { DashboardPageFrame } from './dashboard-page-frame'

const ESSENTIAL_PANELS = new Set([
  'overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings',
])

function LocalModeUnavailable({ panel }: { panel: string }) {
  const t = useTranslations('page')
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 py-24 text-center">
      <h1 className="text-xl font-semibold text-foreground">{panel}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('requiresGateway', { panel })}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('configureGateway')}</p>
    </div>
  )
}

function routedContent(tab: string, isLocal: boolean): ReactNode {
  switch (tab) {
    case 'overview':
      return <><Dashboard />{!isLocal && <div className="m-4 overflow-hidden rounded-lg border border-border bg-card"><AgentCommsPanel /></div>}</>
    case 'tasks': return <TaskBoardPanel />
    case 'agents': return <><OrchestrationBar />{isLocal && <LocalAgentsDocPanel />}<AgentSquadPanelPhase3 /></>
    case 'notifications': return <NotificationsPanel />
    case 'standup': return <StandupPanel />
    case 'logs': return <LogViewerPanel />
    case 'cron': return <CronManagementPanel />
    case 'memory': return <MemoryBrowserPanel />
    case 'knowledge-graph': return <MemoryBrowserPanel defaultView="graph" />
    case 'cost-tracker': return <CostTrackerPanel />
    case 'users': return <UserManagementPanel />
    case 'activity': return <ActivityFeedPanel />
    case 'audit': return <AuditTrailPanel />
    case 'webhooks': return <WebhookPanel />
    case 'alerts': return <AlertRulesPanel />
    case 'gateways': return isLocal ? <GatewayControlPanel /> : <MultiGatewayPanel />
    case 'gateway-config': return isLocal ? <LocalModeUnavailable panel={tab} /> : <GatewayConfigPanel />
    case 'integrations': return <IntegrationsPanel />
    case 'settings': return <SettingsPanel />
    case 'super-admin': return <SuperAdminPanel />
    case 'github': return <GitHubSyncPanel />
    case 'office': return <OfficePanel />
    case 'monitor': return <SystemMonitorPanel />
    case 'fly': return <FlyOrchestrationPanel />
    case 'skills': return <SkillsPanel />
    case 'channels': return isLocal ? <LocalModeUnavailable panel={tab} /> : <ChannelsPanel />
    case 'nodes': return isLocal ? <LocalModeUnavailable panel={tab} /> : <NodesPanel />
    case 'security': return <SecurityAuditPanel />
    case 'debug': return <DebugPanel />
    case 'exec-approvals': return isLocal ? <LocalModeUnavailable panel={tab} /> : <ExecApprovalPanel />
    case 'chat': return <ChatPagePanel />
    default: {
      const PluginPanel = getPluginPanel(tab)
      return PluginPanel ? createElement(PluginPanel) : <UnknownPanel panel={tab} />
    }
  }
}

export function ContentRouter({ tab }: { tab: string }) {
  const { dashboardMode, interfaceMode } = useMissionControl()
  const isLocal = dashboardMode === 'local'
  const content = interfaceMode === 'essential' && !ESSENTIAL_PANELS.has(tab)
    ? <FullModeRequired panelId={tab} />
    : routedContent(tab, isLocal)

  return <DashboardPageFrame panelId={tab}>{content}</DashboardPageFrame>
}
