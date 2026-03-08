export interface DashboardWidget {
  id: string
  label: string
  description: string
  category: 'health' | 'sessions' | 'tasks' | 'metrics' | 'integrations' | 'events'
  modes: ('local' | 'full')[]
  defaultSize: 'sm' | 'md' | 'lg' | 'full'
  component: string
}

export const WIDGET_CATALOG: DashboardWidget[] = [
  {
    id: 'metric-cards',
    label: 'Key Metrics',
    description: 'Top-line stats — sessions, load, tokens, cost',
    category: 'metrics',
    modes: ['local', 'full'],
    defaultSize: 'full',
    component: 'MetricCardsWidget',
  },
  {
    id: 'runtime-health',
    label: 'Runtime Health',
    description: 'Local OS, Claude, Codex, and MC core health',
    category: 'health',
    modes: ['local'],
    defaultSize: 'md',
    component: 'RuntimeHealthWidget',
  },
  {
    id: 'gateway-health',
    label: 'Gateway Health',
    description: 'Gateway golden signals — traffic, errors, saturation',
    category: 'health',
    modes: ['full'],
    defaultSize: 'md',
    component: 'GatewayHealthWidget',
  },
  {
    id: 'session-workbench',
    label: 'Session Workbench',
    description: 'Live session list with activity indicators',
    category: 'sessions',
    modes: ['local', 'full'],
    defaultSize: 'md',
    component: 'SessionWorkbenchWidget',
  },
  {
    id: 'event-stream',
    label: 'Event Stream',
    description: 'Merged log stream from all sources',
    category: 'events',
    modes: ['local', 'full'],
    defaultSize: 'md',
    component: 'EventStreamWidget',
  },
  {
    id: 'task-flow',
    label: 'Task Flow',
    description: 'Task status counts — inbox, assigned, in progress, review, done',
    category: 'tasks',
    modes: ['local', 'full'],
    defaultSize: 'sm',
    component: 'TaskFlowWidget',
  },
  {
    id: 'github-signal',
    label: 'GitHub Signal',
    description: 'GitHub repo stats — issues, stars, repos',
    category: 'integrations',
    modes: ['local'],
    defaultSize: 'sm',
    component: 'GithubSignalWidget',
  },
  {
    id: 'security-audit',
    label: 'Security & Audit',
    description: 'Audit events, login failures, notifications',
    category: 'events',
    modes: ['full'],
    defaultSize: 'sm',
    component: 'SecurityAuditWidget',
  },
  {
    id: 'maintenance',
    label: 'Maintenance & Backup',
    description: 'Backup status, pipeline health',
    category: 'health',
    modes: ['full'],
    defaultSize: 'sm',
    component: 'MaintenanceWidget',
  },
  {
    id: 'quick-actions',
    label: 'Quick Actions',
    description: 'Navigation shortcuts to key panels',
    category: 'sessions',
    modes: ['local', 'full'],
    defaultSize: 'full',
    component: 'QuickActionsWidget',
  },
]

export const LOCAL_DEFAULT_LAYOUT = [
  'metric-cards',
  'runtime-health',
  'session-workbench',
  'event-stream',
  'task-flow',
  'github-signal',
  'quick-actions',
]

export const GATEWAY_DEFAULT_LAYOUT = [
  'metric-cards',
  'gateway-health',
  'session-workbench',
  'event-stream',
  'task-flow',
  'security-audit',
  'maintenance',
  'quick-actions',
]

export function getDefaultLayout(mode: 'local' | 'full'): string[] {
  return mode === 'local' ? LOCAL_DEFAULT_LAYOUT : GATEWAY_DEFAULT_LAYOUT
}

export function getWidgetById(id: string): DashboardWidget | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id)
}

export function getAvailableWidgets(mode: 'local' | 'full'): DashboardWidget[] {
  return WIDGET_CATALOG.filter((w) => w.modes.includes(mode))
}
