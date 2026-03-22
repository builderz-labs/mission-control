/**
 * Agent Identity Map
 *
 * Translates developer-facing agent slugs into operator-facing
 * role titles, one-liners, capability tags, and quick actions.
 *
 * Every agent card answers three questions:
 *   1. What is this agent's job in plain English?
 *   2. What did it last do that matters?
 *   3. What can I ask it to do right now?
 *
 * The slug can exist as a small monospace ID underneath for
 * technical reference. The headline is the job title.
 */

export interface AgentIdentity {
  /** Human-readable role title */
  roleTitle: string
  /** One-sentence description of what this agent does for the operator */
  oneLiner: string
  /** Colored capability tags */
  capabilities: string[]
  /** Plain-English quick action button label: one verb, one object */
  quickAction: string
  /** Where the quick action routes to (panel name or action) */
  quickActionTarget: 'chat' | 'lab' | 'tasks' | string
  /** Emoji or icon hint for the card */
  icon: string
}

/**
 * Known agent identity map.
 * Keys are lowercase agent.name slugs.
 * Unknown agents get a sensible fallback.
 */
const KNOWN_AGENTS: Record<string, AgentIdentity> = {
  // ─── Core Operator ───
  main: {
    roleTitle: 'JARVIS — Your Operator',
    oneLiner: 'Your personal operator. Coordinates the fleet, processes meetings, delivers briefs, and routes your requests to the right agent.',
    capabilities: ['Fleet Coordination', 'Meeting Intelligence', 'Telegram Delivery', 'Task Routing'],
    quickAction: 'Send a message',
    quickActionTarget: 'chat',
    icon: '🎖️',
  },

  // ─── Intelligence Agents ───
  'github-intelligence-agent': {
    roleTitle: 'Codebase Intelligence',
    oneLiner: 'Answers questions about your repos. Analyzes code structure, auth flows, key files, and architectural patterns across all GitHub repositories.',
    capabilities: ['Code Analysis', 'Repo Search', 'Architecture Review', 'File Discovery'],
    quickAction: 'Ask about a repo',
    quickActionTarget: 'chat',
    icon: '🔍',
  },

  'backend-architect': {
    roleTitle: 'Code Architect',
    oneLiner: 'Designs and reviews backend architecture. Evaluates system design, API structure, database schemas, and infrastructure patterns.',
    capabilities: ['System Design', 'Code Review', 'API Architecture', 'Schema Design'],
    quickAction: 'Review architecture',
    quickActionTarget: 'chat',
    icon: '🏗️',
  },

  'engineering-summary-interpreter': {
    roleTitle: 'Engineering Summary',
    oneLiner: 'Generates daily engineering summaries. Tracks what shipped, what\'s blocked, and what needs attention across all repos and projects.',
    capabilities: ['Daily Summary', 'Blocker Detection', 'Ship Tracking', 'Gap Analysis'],
    quickAction: 'Get today\'s summary',
    quickActionTarget: 'chat',
    icon: '📊',
  },

  // ─── Task Execution Agents ───
  dispatch_twin: {
    roleTitle: 'Twin Dispatcher',
    oneLiner: 'Routes tasks to the right Twin agent. Handles ClickUp operations, GitHub actions, and cross-platform task execution.',
    capabilities: ['Task Routing', 'ClickUp Ops', 'GitHub Actions', 'Cross-Platform'],
    quickAction: 'Dispatch a task',
    quickActionTarget: 'lab',
    icon: '🚀',
  },

  'clickup-orchestrator': {
    roleTitle: 'ClickUp Orchestrator',
    oneLiner: 'Manages your ClickUp workspace. Creates tasks from meeting notes, distributes action items, and keeps projects organized.',
    capabilities: ['Task Creation', 'Meeting Notes', 'Action Items', 'Project Ops'],
    quickAction: 'Post meeting notes',
    quickActionTarget: 'chat',
    icon: '📋',
  },

  // ─── Communication Agents ───
  'morning-brief': {
    roleTitle: 'Morning Brief',
    oneLiner: 'Delivers your morning intelligence briefing. Summarizes overnight activity, upcoming meetings, and items needing your attention.',
    capabilities: ['Daily Brief', 'Priority Alerts', 'Schedule Summary', 'Overnight Digest'],
    quickAction: 'Get morning brief',
    quickActionTarget: 'chat',
    icon: '☀️',
  },

  'afternoon-intel': {
    roleTitle: 'Afternoon Intelligence',
    oneLiner: 'Delivers afternoon status updates. Tracks progress against morning priorities and surfaces anything that shifted during the day.',
    capabilities: ['Status Update', 'Priority Tracking', 'Shift Detection', 'EOD Prep'],
    quickAction: 'Get afternoon update',
    quickActionTarget: 'chat',
    icon: '🌤️',
  },

  // ─── System / Pipeline Agents ───
  dogfood: {
    roleTitle: 'Pipeline Validator',
    oneLiner: 'Tests agent pipelines end-to-end. Validates that hooks fire correctly, briefs deliver, and the system is healthy before you rely on it.',
    capabilities: ['Pipeline Testing', 'Hook Validation', 'Health Check', 'E2E Testing'],
    quickAction: 'Run health check',
    quickActionTarget: 'lab',
    icon: '🧪',
  },

  'context-agent': {
    roleTitle: 'Context Engine',
    oneLiner: 'Provides unified search across ClickUp and GitHub via Airweave. Finds relevant context when agents need background for a task.',
    capabilities: ['Unified Search', 'Context Retrieval', 'ClickUp Search', 'GitHub Search'],
    quickAction: 'Search for context',
    quickActionTarget: 'chat',
    icon: '🧠',
  },

  'email-scanner': {
    roleTitle: 'Email Intelligence',
    oneLiner: 'Scans and summarizes important emails. Flags items that need your attention and routes actionable items to the right agent.',
    capabilities: ['Email Scan', 'Priority Flagging', 'Action Routing', 'Digest'],
    quickAction: 'Scan emails',
    quickActionTarget: 'chat',
    icon: '📧',
  },

  'code-executor': {
    roleTitle: 'Code Runner',
    oneLiner: 'Executes code tasks and creates pull requests. Handles Claude Code dispatch for implementation work across your repositories.',
    capabilities: ['Code Execution', 'PR Creation', 'Claude Code', 'Implementation'],
    quickAction: 'Run a code task',
    quickActionTarget: 'lab',
    icon: '⚡',
  },

  'perplexity-computer': {
    roleTitle: 'Research Intelligence',
    oneLiner: 'Conducts deep research and competitive analysis. Answers complex questions by searching across the web and synthesizing findings.',
    capabilities: ['Deep Research', 'Competitive Intel', 'Web Search', 'Synthesis'],
    quickAction: 'Research a topic',
    quickActionTarget: 'chat',
    icon: '🔬',
  },

  'webhook-handler': {
    roleTitle: 'Webhook Router',
    oneLiner: 'Processes incoming webhooks from external services. Routes Zoom transcripts, GitHub events, and other integrations to the right handler.',
    capabilities: ['Webhook Processing', 'Event Routing', 'Zoom Transcripts', 'Integration Hub'],
    quickAction: 'View webhooks',
    quickActionTarget: 'webhooks',
    icon: '🔗',
  },
}

/**
 * Get the operator-facing identity for an agent.
 * Falls back to a sensible default derived from the agent name.
 */
export function getAgentIdentity(agentName: string): AgentIdentity {
  // Try exact match first
  const key = agentName.toLowerCase().trim()
  if (KNOWN_AGENTS[key]) return KNOWN_AGENTS[key]

  // Try partial match (e.g., "github-intelligence" matches "github-intelligence-agent")
  for (const [slug, identity] of Object.entries(KNOWN_AGENTS)) {
    if (key.includes(slug) || slug.includes(key)) return identity
  }

  // Fallback: derive a readable name from the slug
  const readable = agentName
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

  return {
    roleTitle: readable,
    oneLiner: `Agent "${agentName}" — check soul content or working memory for details on this agent's role.`,
    capabilities: [],
    quickAction: 'Open in chat',
    quickActionTarget: 'chat',
    icon: '🤖',
  }
}

/**
 * Check if an agent's last action is stale (>24h).
 * Used for visual dimming of the card accent border.
 */
export function isAgentStale(lastSeenTimestamp?: number): boolean {
  if (!lastSeenTimestamp) return true
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  return (Date.now() - lastSeenTimestamp * 1000) > TWENTY_FOUR_HOURS
}

/**
 * Get freshness label for an agent.
 * Returns a human-readable string about recency.
 */
export function getFreshnessLabel(lastSeenTimestamp?: number): string {
  if (!lastSeenTimestamp) return 'No runs yet'
  const diff = Date.now() - lastSeenTimestamp * 1000
  if (diff < 60_000) return 'Active just now'
  if (diff < 3_600_000) return `Active ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `Active ${Math.floor(diff / 3_600_000)}h ago`
  return `Last active ${Math.floor(diff / 86_400_000)}d ago`
}
