/**
 * Static command registry for the ⌘K command bar.
 * Builds the full list of searchable commands from nav panels + agents + quick actions.
 */

export interface Command {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly type: 'panel' | 'agent' | 'action'
  readonly panelId?: string
  readonly agentName?: string
  readonly icon?: string
  readonly keywords?: readonly string[]
}

/** All navigable panels derived from nav-rail.tsx navGroups */
const PANEL_COMMANDS: readonly Command[] = [
  // Core
  { id: 'panel-overview',       label: 'Overview',         description: 'Mission dashboard',            type: 'panel', panelId: 'overview',       icon: '🏠', keywords: ['home', 'dashboard', 'summary'] },
  { id: 'panel-agents',         label: 'Agents',           description: 'Agent squad management',       type: 'panel', panelId: 'agents',         icon: '🤖', keywords: ['squad', 'workers', 'bots'] },
  { id: 'panel-tasks',          label: 'Tasks',            description: 'Task board',                   type: 'panel', panelId: 'tasks',          icon: '✅', keywords: ['task board', 'tickets', 'todos'] },
  { id: 'panel-chat',           label: 'Chat',             description: 'Chat sessions',                type: 'panel', panelId: 'chat',           icon: '💬', keywords: ['sessions', 'messages', 'conversations'] },
  { id: 'panel-jarvis',         label: 'JARVIS',           description: 'Voice assistant interface',    type: 'panel', panelId: 'jarvis',         icon: '🎙️', keywords: ['voice', 'assistant', 'ai'] },
  { id: 'panel-channels',       label: 'Channels',         description: 'Communication channels',       type: 'panel', panelId: 'channels',       icon: '📡', keywords: ['comms', 'broadcast'] },
  { id: 'panel-skills',         label: 'Skills',           description: 'Skill catalog & management',   type: 'panel', panelId: 'skills',         icon: '🧠', keywords: ['skill packs', 'capabilities'] },
  { id: 'panel-memory',         label: 'Memory',           description: 'Memory graph browser',         type: 'panel', panelId: 'memory',         icon: '🗄️', keywords: ['knowledge', 'notes', 'graph'] },
  // Observe
  { id: 'panel-activity',       label: 'Activity',         description: 'Activity feed',                type: 'panel', panelId: 'activity',       icon: '📊', keywords: ['events', 'feed', 'history'] },
  { id: 'panel-logs',           label: 'Logs',             description: 'Log viewer',                   type: 'panel', panelId: 'logs',           icon: '📋', keywords: ['log viewer', 'errors', 'debug'] },
  { id: 'panel-cost-tracker',   label: 'Cost Tracker',     description: 'Token usage & costs',          type: 'panel', panelId: 'cost-tracker',   icon: '💰', keywords: ['tokens', 'spend', 'billing'] },
  { id: 'panel-agent-cost',     label: 'Agent Costs',      description: 'Per-agent cost breakdown',     type: 'panel', panelId: 'agent-cost',     icon: '💸', keywords: ['cost', 'spend', 'budget'] },
  { id: 'panel-token-dashboard',label: 'Token Analytics',  description: 'Token usage analytics',        type: 'panel', panelId: 'token-dashboard',icon: '📈', keywords: ['tokens', 'usage', 'analytics'] },
  { id: 'panel-notifications',  label: 'Notifications',    description: 'Notification center',          type: 'panel', panelId: 'notifications',  icon: '🔔', keywords: ['alerts inbox', 'alerts'] },
  { id: 'panel-standup',        label: 'Standup',          description: 'Daily standup report',         type: 'panel', panelId: 'standup',        icon: '🗣️', keywords: ['daily', 'report', 'meeting'] },
  { id: 'panel-agent-history',  label: 'Agent History',    description: 'Agent execution history',      type: 'panel', panelId: 'agent-history',  icon: '🕐', keywords: ['runs', 'executions'] },
  { id: 'panel-nodes',          label: 'Nodes',            description: 'Cluster nodes',                type: 'panel', panelId: 'nodes',          icon: '🖥️', keywords: ['cluster', 'servers', 'infra'] },
  { id: 'panel-exec-approvals', label: 'Approvals',        description: 'Exec approval queue',          type: 'panel', panelId: 'exec-approvals', icon: '✋', keywords: ['approval', 'exec', 'queue'] },
  { id: 'panel-office',         label: 'Office',           description: 'Office & workspace',           type: 'panel', panelId: 'office',         icon: '🏢', keywords: ['workspace', 'team', 'office'] },
  // Automate
  { id: 'panel-cron',           label: 'Cron',             description: 'Cron job management',          type: 'panel', panelId: 'cron',           icon: '⏰', keywords: ['scheduler', 'jobs', 'schedule'] },
  { id: 'panel-pipeline',       label: 'Pipelines',        description: 'Pipeline management',          type: 'panel', panelId: 'pipeline',       icon: '🔀', keywords: ['workflow', 'automation'] },
  { id: 'panel-webhooks',       label: 'Webhooks',         description: 'Webhook management',           type: 'panel', panelId: 'webhooks',       icon: '🔗', keywords: ['hooks', 'integrations', 'events'] },
  { id: 'panel-alerts',         label: 'Alerts',           description: 'Alert rules',                  type: 'panel', panelId: 'alerts',         icon: '🚨', keywords: ['notifications', 'rules', 'monitoring'] },
  { id: 'panel-github',         label: 'GitHub',           description: 'GitHub sync',                  type: 'panel', panelId: 'github',         icon: '🐙', keywords: ['git', 'sync', 'repos', 'code'] },
  // Workspace
  { id: 'panel-presentations',  label: 'Presentations',    description: 'Presentation builder',         type: 'panel', panelId: 'presentations',  icon: '📊', keywords: ['slides', 'deck', 'pptx'] },
  { id: 'panel-documents',      label: 'Documents',        description: 'Document management',          type: 'panel', panelId: 'documents',      icon: '📄', keywords: ['docs', 'files', 'reports'] },
  { id: 'panel-session-details',label: 'Session Details',  description: 'Session inspection',           type: 'panel', panelId: 'session-details',icon: '🔍', keywords: ['sessions', 'inspect', 'details'] },
  // Admin
  { id: 'panel-security',       label: 'Security',         description: 'Security audit panel',         type: 'panel', panelId: 'security',       icon: '🛡️', keywords: ['audit', 'vulnerabilities', 'scan'] },
  { id: 'panel-users',          label: 'Users',            description: 'User management',              type: 'panel', panelId: 'users',           icon: '👥', keywords: ['accounts', 'members', 'roles'] },
  { id: 'panel-audit',          label: 'Audit',            description: 'Audit trail',                  type: 'panel', panelId: 'audit',           icon: '📜', keywords: ['trail', 'logs', 'compliance'] },
  { id: 'panel-gateways',       label: 'Gateways',         description: 'Gateway management',           type: 'panel', panelId: 'gateways',        icon: '🌐', keywords: ['gateway', 'network', 'proxy'] },
  { id: 'panel-gateway-config', label: 'Gateway Config',   description: 'Gateway configuration',        type: 'panel', panelId: 'gateway-config',  icon: '⚙️', keywords: ['config', 'gateway', 'setup'] },
  { id: 'panel-integrations',   label: 'Integrations',     description: 'Third-party integrations',     type: 'panel', panelId: 'integrations',    icon: '🔌', keywords: ['providers', 'api keys', 'connect'] },
  { id: 'panel-debug',          label: 'Debug',            description: 'Debug panel',                  type: 'panel', panelId: 'debug',           icon: '🐛', keywords: ['dev tools', 'inspect', 'trace'] },
  { id: 'panel-settings',       label: 'Settings',         description: 'Application settings',         type: 'panel', panelId: 'settings',        icon: '⚙️', keywords: ['preferences', 'config', 'configure'] },
]

/** Static quick-action commands */
const ACTION_COMMANDS: readonly Command[] = [
  {
    id: 'action-war-room',
    label: 'Open War Room',
    description: 'Navigate to overview with all panels',
    type: 'action',
    panelId: 'overview',
    icon: '⚔️',
    keywords: ['war room', 'all panels', 'command center'],
  },
  {
    id: 'action-leaderboard',
    label: 'View Leaderboard',
    description: 'Agent performance standings',
    type: 'action',
    panelId: 'activity',
    icon: '🏆',
    keywords: ['leaderboard', 'rankings', 'performance'],
  },
  {
    id: 'action-intel-brief',
    label: 'Generate Intel Brief',
    description: 'AI-generated mission status brief',
    type: 'action',
    panelId: 'standup',
    icon: '📰',
    keywords: ['intel', 'brief', 'report', 'summary'],
  },
  {
    id: 'action-new-task',
    label: 'New Task',
    description: 'Create a new task on the board',
    type: 'action',
    panelId: 'tasks',
    icon: '➕',
    keywords: ['create task', 'add task', 'new ticket'],
  },
  {
    id: 'action-system-health',
    label: 'System Health',
    description: 'Check autonomous engine status',
    type: 'action',
    panelId: 'debug',
    icon: '❤️',
    keywords: ['health', 'status', 'engines', 'monitoring'],
  },
]

/**
 * Builds agent commands from a live agent list.
 * Uses agents loaded from /api/agents at boot time.
 */
export function buildCommandRegistry(
  agents: ReadonlyArray<{ readonly name: string; readonly role: string; readonly department: string }>
): Command[] {
  const agentCommands: Command[] = agents.map(agent => ({
    id: `agent-${agent.name.toLowerCase().replace(/\s+/g, '-')}`,
    label: `Talk to ${agent.name}`,
    description: `${agent.role} · ${agent.department}`,
    type: 'action' as const,
    panelId: 'chat',
    agentName: agent.name,
    icon: '🤖',
    keywords: [agent.name.toLowerCase(), agent.role.toLowerCase(), agent.department.toLowerCase(), 'agent', 'talk', 'chat'],
  }))

  return [
    ...PANEL_COMMANDS,
    ...ACTION_COMMANDS,
    ...agentCommands,
  ]
}

/** Full static registry (no live agents). Used as fallback before agents load. */
export const STATIC_COMMAND_REGISTRY: readonly Command[] = [
  ...PANEL_COMMANDS,
  ...ACTION_COMMANDS,
]
