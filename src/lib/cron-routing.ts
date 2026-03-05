/**
 * Smart cron job model routing
 * Assigns the right agent + model + thinking level based on task type
 */

export type CronTier = 'ops' | 'analysis' | 'content' | 'complex'

export interface CronRoute {
  tier: CronTier
  agentId: string
  model: string
  thinking?: 'low' | 'medium' | 'high'
  description: string
  costHint: string
}

const CRON_ROUTES: Record<CronTier, CronRoute> = {
  ops: {
    tier: 'ops',
    agentId: 'zenith',
    model: 'ollama/qwen3.5-4b-local',
    thinking: undefined,
    description: 'System ops, health checks, backups, monitoring',
    costHint: 'Free (local model)'
  },
  analysis: {
    tier: 'analysis',
    agentId: 'prism',
    model: 'openai/gpt-5.2',
    thinking: 'medium',
    description: 'Reports, metrics, cost analysis, trend tracking',
    costHint: 'GPT-5.2 medium thinking'
  },
  content: {
    tier: 'content',
    agentId: 'aurora',
    model: 'ollama/qwen3.5-9b-local',
    thinking: undefined,
    description: 'Scheduled digests, summaries, changelogs',
    costHint: 'Free local → GPT fallback if needed'
  },
  complex: {
    tier: 'complex',
    agentId: 'conductor',
    model: 'openai/gpt-5.2',
    thinking: 'high',
    description: 'Multi-step pipelines, code audits, automated workflows',
    costHint: 'GPT-5.2 high thinking + sub-agents'
  }
}

// Keywords that signal each tier
const TIER_SIGNALS: Record<CronTier, string[]> = {
  ops: [
    'disk', 'memory', 'cpu', 'health', 'check', 'backup', 'restart',
    'ping', 'monitor', 'cleanup', 'log', 'rotate', 'service', 'status',
    'uptime', 'alert', 'prune', 'gc', 'temp', 'free space'
  ],
  analysis: [
    'report', 'usage', 'cost', 'token', 'metric', 'analytics', 'trend',
    'summary', 'stats', 'performance', 'weekly', 'monthly', 'daily report',
    'breakdown', 'spending', 'billing'
  ],
  content: [
    'digest', 'newsletter', 'changelog', 'standup', 'update', 'post',
    'write', 'draft', 'publish', 'content', 'announcement'
  ],
  complex: [
    'audit', 'review', 'refactor', 'pipeline', 'workflow', 'deploy',
    'build', 'test suite', 'dependency', 'security scan', 'multi-step',
    'coordinate', 'orchestrate'
  ]
}

/**
 * Infer the best cron tier from a job name/message
 */
export function inferCronTier(text: string): CronTier {
  const lower = text.toLowerCase()
  const scores: Record<CronTier, number> = { ops: 0, analysis: 0, content: 0, complex: 0 }

  for (const [tier, keywords] of Object.entries(TIER_SIGNALS) as [CronTier, string[]][]) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[tier]++
    }
  }

  const best = (Object.entries(scores) as [CronTier, number][])
    .sort((a, b) => b[1] - a[1])[0]

  // Default to ops if nothing matches
  return best[1] > 0 ? best[0] : 'ops'
}

export function getCronRoute(tier: CronTier): CronRoute {
  return CRON_ROUTES[tier]
}

export function suggestCronRoute(jobNameOrMessage: string): CronRoute {
  const tier = inferCronTier(jobNameOrMessage)
  return getCronRoute(tier)
}

export function getAllCronRoutes(): CronRoute[] {
  return Object.values(CRON_ROUTES)
}
