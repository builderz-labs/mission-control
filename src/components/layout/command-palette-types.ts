export interface SearchResult {
  type: string
  id: number
  title: string
  subtitle?: string
  excerpt?: string
  created_at: number
  panel?: string
  source?: 'command' | 'entity'
}

export const QUICK_NAV_COMMANDS: Array<{
  panel: string
  titleKey: string
  title: string
  aliases: string[]
}> = [
  { panel: 'overview', titleKey: 'goToOverview', title: 'Go to Overview', aliases: ['home', 'dashboard'] },
  { panel: 'chat', titleKey: 'goToChat', title: 'Go to Chat', aliases: ['sessions', 'messages'] },
  { panel: 'tasks', titleKey: 'goToTasks', title: 'Go to Tasks', aliases: ['task board', 'tickets'] },
  { panel: 'agents', titleKey: 'goToAgents', title: 'Go to Agents', aliases: ['agent squad', 'workers'] },
  { panel: 'activity', titleKey: 'goToActivityFeed', title: 'Go to Activity Feed', aliases: ['events', 'feed'] },
  { panel: 'notifications', titleKey: 'goToNotifications', title: 'Go to Notifications', aliases: ['alerts inbox'] },
  { panel: 'tokens', titleKey: 'goToTokenUsage', title: 'Go to Token Usage', aliases: ['cost', 'spend'] },
  { panel: 'logs', titleKey: 'goToLogs', title: 'Go to Logs', aliases: ['log viewer'] },
  { panel: 'memory', titleKey: 'goToMemoryBrowser', title: 'Go to Memory Browser', aliases: ['knowledge', 'notes'] },
  { panel: 'integrations', titleKey: 'goToIntegrations', title: 'Go to Integrations', aliases: ['providers', 'api keys'] },
  { panel: 'settings', titleKey: 'goToSettings', title: 'Go to Settings', aliases: ['preferences', 'config'] },
  { panel: 'gateways', titleKey: 'goToGateways', title: 'Go to Gateways', aliases: ['gateway manager'] },
  { panel: 'github', titleKey: 'goToGithubSync', title: 'Go to GitHub Sync', aliases: ['github', 'sync'] },
  { panel: 'office', titleKey: 'goToOffice', title: 'Go to Office', aliases: ['workspace', 'team'] },
  { panel: 'skills', titleKey: 'goToSkills', title: 'Go to Skills', aliases: ['skill packs', 'agent skills'] },
]

export const TYPE_ICONS: Record<string, string> = {
  panel: '>',
  task: 'T', agent: 'A', activity: 'E', audit: 'S',
  message: 'M', notification: 'N', webhook: 'W', pipeline: 'P',
}

export const TYPE_COLORS: Record<string, string> = {
  panel: 'bg-primary/20 text-primary',
  task: 'bg-blue-500/20 text-blue-400',
  agent: 'bg-purple-500/20 text-purple-400',
  activity: 'bg-green-500/20 text-green-400',
  audit: 'bg-amber-500/20 text-amber-400',
  message: 'bg-cyan-500/20 text-cyan-400',
  notification: 'bg-red-500/20 text-red-400',
  webhook: 'bg-orange-500/20 text-orange-400',
  pipeline: 'bg-indigo-500/20 text-indigo-400',
}
