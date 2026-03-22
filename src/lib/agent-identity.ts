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
 * Fleet Tiers:
 *   'operator'  — OpenClaw (JARVIS main). The communication layer.
 *   'primary'   — Twin agents. Cloud-based execution fleet at build.twin.so.
 *   'external'  — External platforms (Perplexity Computer, etc.). Static cards, no live heartbeat.
 *   'devtools'  — Local Claude Code sub-agents. Coding assistants on the Mac.
 *   'hidden'    — Not real agents (skills, QA stubs). Excluded from UI.
 */

export type FleetTier = 'operator' | 'primary' | 'external' | 'devtools' | 'hidden'

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
  /** Fleet tier for grouping and visual treatment */
  tier: FleetTier
  /** Where this agent runs */
  runtime?: string
}

/**
 * Known agent identity map.
 * Keys are lowercase agent.name slugs.
 * Unknown agents get a sensible fallback.
 */
const KNOWN_AGENTS: Record<string, AgentIdentity> = {

  // ═══════════════════════════════════════════
  // OPERATOR — OpenClaw / JARVIS Main
  // The communication layer. Runs on Mac Mini.
  // Delivers everything to Telegram.
  // ═══════════════════════════════════════════

  main: {
    roleTitle: 'JARVIS — Your Operator',
    oneLiner: 'Your personal operator. Coordinates the fleet, processes meetings, delivers briefs, and routes your requests to the right agent.',
    capabilities: ['Fleet Coordination', 'Meeting Intelligence', 'Telegram Delivery', 'Task Routing'],
    quickAction: 'Send a message',
    quickActionTarget: 'chat',
    icon: '🎖️',
    tier: 'operator',
    runtime: 'Mac Mini (OpenClaw)',
  },

  // ═══════════════════════════════════════════
  // PRIMARY FLEET — Twin Agents
  // Cloud-based execution agents at build.twin.so.
  // These are the operator's workhorses.
  // ═══════════════════════════════════════════

  'github-intelligence-agent': {
    roleTitle: 'Codebase Intelligence',
    oneLiner: 'Answers questions about your repos. Analyzes code structure, auth flows, key files, and architectural patterns across all GitHub repositories via Augment MCP.',
    capabilities: ['Code Analysis', 'Repo Search', 'Architecture Review', 'File Discovery'],
    quickAction: 'Ask about a repo',
    quickActionTarget: 'chat',
    icon: '🔍',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  'engineering-summary-interpreter': {
    roleTitle: 'Engineering Summary',
    oneLiner: 'Generates daily engineering summaries. Reads the ClickUp daily doc and fires at 5:30 PM CT weekdays. Tracks what shipped, what\'s blocked, and what needs attention.',
    capabilities: ['Daily Summary', 'Blocker Detection', 'Ship Tracking', 'Gap Analysis'],
    quickAction: 'Get today\'s summary',
    quickActionTarget: 'chat',
    icon: '📊',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  'clickup-super-agent-orchestrator': {
    roleTitle: 'ClickUp Super Agent',
    oneLiner: 'Routes meeting notes to ClickUp. Creates tasks, distributes action items, and keeps projects organized from meeting transcripts.',
    capabilities: ['Task Creation', 'Meeting Notes', 'Action Items', 'Project Ops'],
    quickAction: 'Post meeting notes',
    quickActionTarget: 'chat',
    icon: '📋',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  // Alias for the ClickUp agent (may appear as different slugs)
  'clickup-orchestrator': {
    roleTitle: 'ClickUp Super Agent',
    oneLiner: 'Routes meeting notes to ClickUp. Creates tasks, distributes action items, and keeps projects organized from meeting transcripts.',
    capabilities: ['Task Creation', 'Meeting Notes', 'Action Items', 'Project Ops'],
    quickAction: 'Post meeting notes',
    quickActionTarget: 'chat',
    icon: '📋',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  'airweave-context-agent': {
    roleTitle: 'Airweave Context',
    oneLiner: 'Searches ClickUp + GitHub via Airweave for unified context. Finds relevant background when agents need information to complete a task.',
    capabilities: ['Unified Search', 'Context Retrieval', 'ClickUp Search', 'GitHub Search'],
    quickAction: 'Search for context',
    quickActionTarget: 'chat',
    icon: '🧠',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  // Alias
  'context-agent': {
    roleTitle: 'Airweave Context',
    oneLiner: 'Searches ClickUp + GitHub via Airweave for unified context. Finds relevant background when agents need information to complete a task.',
    capabilities: ['Unified Search', 'Context Retrieval', 'ClickUp Search', 'GitHub Search'],
    quickAction: 'Search for context',
    quickActionTarget: 'chat',
    icon: '🧠',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  'claude-code-dispatch-agent': {
    roleTitle: 'Twin Dispatcher',
    oneLiner: 'Sends code tasks to Claude Code and opens PRs. The execution bridge between your instructions and actual code changes in your repositories.',
    capabilities: ['Code Execution', 'PR Creation', 'Claude Code', 'Implementation'],
    quickAction: 'Run a code task',
    quickActionTarget: 'lab',
    icon: '⚡',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  // Alias
  'code-executor': {
    roleTitle: 'Twin Dispatcher',
    oneLiner: 'Sends code tasks to Claude Code and opens PRs. The execution bridge between your instructions and actual code changes in your repositories.',
    capabilities: ['Code Execution', 'PR Creation', 'Claude Code', 'Implementation'],
    quickAction: 'Run a code task',
    quickActionTarget: 'lab',
    icon: '⚡',
    tier: 'primary',
    runtime: 'build.twin.so',
  },

  // ═══════════════════════════════════════════
  // DEV TOOLS — Local Claude Code Sub-Agents
  // Specialized coding assistants that Claude Code
  // spawns on the Mac when working on specific tasks.
  // ═══════════════════════════════════════════

  'code-architect': {
    roleTitle: 'Code Architect',
    oneLiner: 'Designs system architecture and evaluates structural decisions. Spawned by Claude Code for architecture-heavy tasks.',
    capabilities: ['System Design', 'API Architecture', 'Schema Design'],
    quickAction: 'Review architecture',
    quickActionTarget: 'chat',
    icon: '🏗️',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'backend-architect': {
    roleTitle: 'Code Architect',
    oneLiner: 'Designs system architecture and evaluates structural decisions. Spawned by Claude Code for architecture-heavy tasks.',
    capabilities: ['System Design', 'API Architecture', 'Schema Design'],
    quickAction: 'Review architecture',
    quickActionTarget: 'chat',
    icon: '🏗️',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'code-reviewer': {
    roleTitle: 'Code Reviewer',
    oneLiner: 'Reviews pull requests and code changes for quality, security, and consistency. Catches issues before they merge.',
    capabilities: ['Code Review', 'Security Audit', 'Style Check'],
    quickAction: 'Review code',
    quickActionTarget: 'chat',
    icon: '👁️',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'database-optimizer': {
    roleTitle: 'Database Optimizer',
    oneLiner: 'Analyzes and optimizes database queries, schemas, and indexes. Improves performance for slow or complex data operations.',
    capabilities: ['Query Optimization', 'Schema Tuning', 'Index Analysis'],
    quickAction: 'Optimize queries',
    quickActionTarget: 'chat',
    icon: '🗄️',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'debugger': {
    roleTitle: 'Debugger',
    oneLiner: 'Diagnoses and fixes bugs. Traces error flows, analyzes stack traces, and proposes targeted fixes.',
    capabilities: ['Bug Diagnosis', 'Error Tracing', 'Fix Proposals'],
    quickAction: 'Debug an issue',
    quickActionTarget: 'chat',
    icon: '🐛',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'frontend-developer': {
    roleTitle: 'Frontend Developer',
    oneLiner: 'Builds and refines frontend components. Handles React, Tailwind, layout, responsiveness, and UI polish.',
    capabilities: ['React Components', 'Tailwind CSS', 'UI Polish', 'Responsive Design'],
    quickAction: 'Build a component',
    quickActionTarget: 'chat',
    icon: '🎨',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'ui-ux-designer': {
    roleTitle: 'UI/UX Designer',
    oneLiner: 'Evaluates and improves user experience. Reviews flows, suggests layout improvements, and ensures design consistency.',
    capabilities: ['UX Review', 'Layout Design', 'Design Systems'],
    quickAction: 'Review UX',
    quickActionTarget: 'chat',
    icon: '✏️',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  'url-context-validator': {
    roleTitle: 'URL Context Validator',
    oneLiner: 'Validates URLs and extracts context from web pages. Checks links, scrapes relevant content, and verifies external references.',
    capabilities: ['URL Validation', 'Content Extraction', 'Link Checking'],
    quickAction: 'Validate a URL',
    quickActionTarget: 'chat',
    icon: '🔗',
    tier: 'devtools',
    runtime: 'Local (Claude Code)',
  },

  // ═══════════════════════════════════════════
  // HIDDEN — Not real agents
  // Skills, QA stubs, and other non-operational
  // entries that should not appear in the UI.
  // ═══════════════════════════════════════════

  dispatch_twin: {
    roleTitle: 'Twin Dispatch Skill',
    oneLiner: 'OpenClaw skill file for Twin dispatch routing. Not an operational agent.',
    capabilities: [],
    quickAction: '',
    quickActionTarget: 'lab',
    icon: '📄',
    tier: 'hidden',
  },

  dogfood: {
    roleTitle: 'QA Testing Stub',
    oneLiner: 'QA testing skill for pipeline validation. Not an operational agent.',
    capabilities: [],
    quickAction: '',
    quickActionTarget: 'lab',
    icon: '🧪',
    tier: 'hidden',
  },

  // ═══════════════════════════════════════════
  // SUPPLEMENTARY — Other known agents
  // ═══════════════════════════════════════════

  'morning-brief': {
    roleTitle: 'Morning Brief',
    oneLiner: 'Delivers your morning intelligence briefing. Summarizes overnight activity, upcoming meetings, and items needing your attention.',
    capabilities: ['Daily Brief', 'Priority Alerts', 'Schedule Summary', 'Overnight Digest'],
    quickAction: 'Get morning brief',
    quickActionTarget: 'chat',
    icon: '☀️',
    tier: 'primary',
    runtime: 'Perplexity Computer via OpenClaw',
  },

  'afternoon-intel': {
    roleTitle: 'Afternoon Intelligence',
    oneLiner: 'Delivers afternoon status updates. Tracks progress against morning priorities and surfaces anything that shifted during the day.',
    capabilities: ['Status Update', 'Priority Tracking', 'Shift Detection', 'EOD Prep'],
    quickAction: 'Get afternoon update',
    quickActionTarget: 'chat',
    icon: '🌤️',
    tier: 'primary',
    runtime: 'Perplexity Computer via OpenClaw',
  },

  'perplexity-computer': {
    roleTitle: 'Perplexity Computer',
    oneLiner: 'Your morning intelligence engine. Pulls email, calendar, ClickUp, and Granola meeting context to generate your daily brief and Gmail drafts.',
    capabilities: ['Morning Brief', 'Gmail Drafts', 'Email Triage', 'Meeting Context', 'ClickUp Cross-reference'],
    quickAction: 'Go to Perplexity Computer \u2192',
    quickActionTarget: 'https://www.perplexity.ai',
    icon: '🖥️',
    tier: 'external',
    runtime: 'Perplexity Computer (external)',
  },

  'email-scanner': {
    roleTitle: 'Email Intelligence',
    oneLiner: 'Scans and summarizes important emails. Flags items that need your attention and routes actionable items to the right agent.',
    capabilities: ['Email Scan', 'Priority Flagging', 'Action Routing', 'Digest'],
    quickAction: 'Scan emails',
    quickActionTarget: 'chat',
    icon: '📧',
    tier: 'primary',
    runtime: 'OpenClaw',
  },

  'webhook-handler': {
    roleTitle: 'Webhook Router',
    oneLiner: 'Processes incoming webhooks from external services. Routes Zoom transcripts, GitHub events, and other integrations to the right handler.',
    capabilities: ['Webhook Processing', 'Event Routing', 'Zoom Transcripts', 'Integration Hub'],
    quickAction: 'View webhooks',
    quickActionTarget: 'webhooks',
    icon: '🔗',
    tier: 'primary',
    runtime: 'jarvisv2',
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
    tier: 'devtools', // Unknown agents default to devtools (secondary)
  }
}

/**
 * Get the fleet tier for an agent.
 * Convenience wrapper for sorting and filtering.
 */
export function getAgentTier(agentName: string): FleetTier {
  return getAgentIdentity(agentName).tier
}

/**
 * Check if an agent should be hidden from the UI.
 */
export function isAgentHidden(agentName: string): boolean {
  return getAgentIdentity(agentName).tier === 'hidden'
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

/**
 * Tier display metadata for section headers.
 */
export const TIER_META: Record<FleetTier, { label: string; description: string }> = {
  operator: {
    label: 'Operator',
    description: 'Your communication layer — JARVIS main',
  },
  primary: {
    label: 'Primary Fleet',
    description: 'Cloud-based execution agents at build.twin.so',
  },
  devtools: {
    label: 'Dev Tools',
    description: 'Local Claude Code sub-agents for coding tasks',
  },
  hidden: {
    label: 'Hidden',
    description: 'Non-operational entries',
  },
  external: {
    label: 'External Intelligence',
    description: 'External platforms integrated into your operation',
  },
}

/**
 * Static schedule entries for the full automated operation.
 * These represent everything that runs on a schedule — not just
 * JARVIS registry agents, but the entire operation surface.
 * Some are live (from cron jobs), others are static (external platforms).
 */
export interface OperationSchedule {
  time: string
  days: string
  description: string
  agent: string
  icon: string
  source: 'jarvisv2' | 'openclaw' | 'external' | 'twin'
  /** If true, this is a static entry — not polled from any API */
  isStatic: boolean
}

export const OPERATION_SCHEDULES: OperationSchedule[] = [
  // ── Perplexity Computer ──
  {
    time: '7:15 AM CT',
    days: 'Mon–Fri',
    description: 'Morning brief + Gmail drafts',
    agent: 'Perplexity Computer',
    icon: '🖥️',
    source: 'external',
    isStatic: true,
  },
  {
    time: '2:00 PM CT',
    days: 'Mon–Fri',
    description: 'Afternoon email scan + drafts',
    agent: 'Perplexity Computer',
    icon: '🖥️',
    source: 'external',
    isStatic: true,
  },

  // ── Twin Agents ──
  {
    time: '5:30 PM CT',
    days: 'Mon–Fri',
    description: 'Daily engineering summary from ClickUp doc',
    agent: 'Engineering Summary',
    icon: '📊',
    source: 'twin',
    isStatic: false,
  },

  // ── jarvisv2 Crons ──
  {
    time: '7:00 AM CT',
    days: 'Mon–Fri',
    description: 'Zoom transcript ingestion + processing',
    agent: 'jarvisv2',
    icon: '🎥',
    source: 'jarvisv2',
    isStatic: true,
  },
  {
    time: 'Every 15 min',
    days: 'Daily',
    description: 'Twin agent heartbeat check + status sync',
    agent: 'jarvisv2',
    icon: '💓',
    source: 'jarvisv2',
    isStatic: true,
  },
  {
    time: 'On webhook',
    days: 'Always',
    description: 'Zoom transcript → meeting notes → ClickUp tasks',
    agent: 'jarvisv2 + ClickUp Super Agent',
    icon: '🔗',
    source: 'jarvisv2',
    isStatic: true,
  },

  // ── Airweave ──
  {
    time: 'Every 6 hours',
    days: 'Daily',
    description: 'ClickUp + GitHub index sync for context search',
    agent: 'Airweave',
    icon: '🧠',
    source: 'external',
    isStatic: true,
  },

  // ── Granola ──
  {
    time: 'During meetings',
    days: 'As scheduled',
    description: 'Live meeting transcription + note capture',
    agent: 'Granola',
    icon: '🌾',
    source: 'external',
    isStatic: true,
  },

  // ── OpenClaw ──
  {
    time: 'Always on',
    days: 'Always',
    description: 'Telegram message routing + delivery',
    agent: 'OpenClaw (JARVIS)',
    icon: '🎖️',
    source: 'openclaw',
    isStatic: true,
  },
]
