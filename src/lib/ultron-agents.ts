/**
 * Ultron Agent Hierarchy
 *
 * Defines the 9-department C-Suite agent hierarchy for seeding into the database.
 * Based on the Jarvis agent architecture, adapted for Ultron Mission Control.
 *
 * Tier 1: Ultron (Commander)
 * Tier 2: 9 C-Level heads
 * Tier 3: 48 specialist agents
 */

export interface UltronAgentDefinition {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly department: string
  readonly tier: 1 | 2 | 3
  readonly color: string
  readonly avatar: string
  readonly model: string
  readonly tokenBudget: number
  readonly parentId: string | null
  readonly description: string
}

// Tier 1: Commander
const COMMANDER: UltronAgentDefinition = {
  id: 'ultron',
  name: 'Ultron',
  role: 'Commander',
  department: 'COMMAND',
  tier: 1,
  color: '#FFFFFF',
  avatar: 'U',
  model: 'claude-sonnet-4-6',
  tokenBudget: 100000,
  parentId: null,
  description: 'CEO of Ultron Mission Control. Orchestrates all departments, resolves conflicts, delivers final answers.',
}

// Tier 2: C-Suite heads
const C_SUITE: readonly UltronAgentDefinition[] = [
  {
    id: 'cio-alpha',
    name: 'CIO Alpha',
    role: 'Chief Information Officer',
    department: 'Intelligence',
    tier: 2,
    color: '#00FFFF',
    avatar: 'A',
    model: 'claude-haiku-4-5',
    tokenBudget: 20000,
    parentId: 'ultron',
    description: 'Pattern recognition. Connects dots across datasets. Evidence-first intelligence.',
  },
  {
    id: 'cto-omega',
    name: 'CTO Omega',
    role: 'Chief Technology Officer',
    department: 'Technology',
    tier: 2,
    color: '#0066FF',
    avatar: 'O',
    model: 'claude-sonnet-4-6',
    tokenBudget: 25000,
    parentId: 'ultron',
    description: 'Systems thinking. Build vs buy. Ships production code.',
  },
  {
    id: 'cmo-nexus',
    name: 'CMO Nexus',
    role: 'Chief Marketing Officer',
    department: 'Marketing',
    tier: 2,
    color: '#FF00FF',
    avatar: 'N',
    model: 'claude-haiku-4-5',
    tokenBudget: 25000,
    parentId: 'ultron',
    description: 'Thinks in narratives. Engineers perception. Audience-first.',
  },
  {
    id: 'coo-prime',
    name: 'COO Prime',
    role: 'Chief Operating Officer',
    department: 'Operations',
    tier: 2,
    color: '#FF8800',
    avatar: 'P',
    model: 'claude-haiku-4-5',
    tokenBudget: 15000,
    parentId: 'ultron',
    description: 'Engine room. Treats every manual process as a bug. Measures everything.',
  },
  {
    id: 'clo-relay',
    name: 'CLO Relay',
    role: 'Chief Liaison Officer',
    department: 'Communications',
    tier: 2,
    color: '#9B59B6',
    avatar: 'R',
    model: 'claude-haiku-4-5',
    tokenBudget: 15000,
    parentId: 'ultron',
    description: 'Connective tissue. Controls information flow. Anticipatory and diplomatic.',
  },
  {
    id: 'cso-venture',
    name: 'CSO Venture',
    role: 'Chief Sales Officer',
    department: 'Sales',
    tier: 2,
    color: '#E74C3C',
    avatar: 'V',
    model: 'claude-haiku-4-5',
    tokenBudget: 20000,
    parentId: 'ultron',
    description: 'Pipeline thinker. Relationship-first, data-backed. Qualifies ruthlessly.',
  },
  {
    id: 'cfo-ledger',
    name: 'CFO Ledger',
    role: 'Chief Financial Officer',
    department: 'Finance',
    tier: 2,
    color: '#2ECC71',
    avatar: 'L',
    model: 'claude-haiku-4-5',
    tokenBudget: 15000,
    parentId: 'ultron',
    description: 'Every number tells a story. Precise, conservative, forensic.',
  },
  {
    id: 'cao-sentinel',
    name: 'CAO Sentinel',
    role: 'Chief Audit Officer',
    department: 'Audit',
    tier: 2,
    color: '#1ABC9C',
    avatar: 'S',
    model: 'claude-haiku-4-5',
    tokenBudget: 10000,
    parentId: 'ultron',
    description: 'Never takes "it\'s fine" at face value. Systematic skeptic.',
  },
  {
    id: 'cdo-prism',
    name: 'CDO Prism',
    role: 'Chief Design Officer',
    department: 'Design',
    tier: 2,
    color: '#F39C12',
    avatar: 'D',
    model: 'claude-sonnet-4-6',
    tokenBudget: 25000,
    parentId: 'ultron',
    description: 'Obsessed with craft, not decoration. Design is how it works.',
  },
]

// Tier 3: Specialists
const SPECIALISTS: readonly UltronAgentDefinition[] = [
  // CIO Alpha sub-agents
  { id: 'cio-research', name: 'Research Analyst', role: 'Web Research', department: 'Intelligence', tier: 3, color: '#00FFFF', avatar: 'R', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cio-alpha', description: 'Real-time web research, company lookups, news monitoring' },
  { id: 'cio-intel', name: 'Intel Analyst', role: 'Competitive Intelligence', department: 'Intelligence', tier: 3, color: '#00FFFF', avatar: 'I', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cio-alpha', description: 'Competitive intelligence, market analysis, trend synthesis' },
  { id: 'cio-knowledge', name: 'Knowledge Agent', role: 'Knowledge Base', department: 'Intelligence', tier: 3, color: '#00FFFF', avatar: 'K', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cio-alpha', description: 'Knowledge base management, document indexing, institutional memory' },

  // CTO Omega sub-agents
  { id: 'cto-coding', name: 'Coding Agent', role: 'Full-Stack Dev', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'C', model: 'claude-sonnet-4-6', tokenBudget: 10000, parentId: 'cto-omega', description: 'Full-stack development, debugging, code generation' },
  { id: 'cto-scout', name: 'Tech Scout', role: 'Tool Discovery', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'S', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cto-omega', description: 'AI tool discovery, evaluation, tech stack optimization' },
  { id: 'cto-infra', name: 'Infrastructure Agent', role: 'Infrastructure', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'I', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cto-omega', description: 'Server management, deployment, Docker orchestration' },
  { id: 'cto-automation', name: 'Automation Agent', role: 'Automation', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'A', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cto-omega', description: 'Workflows, API integrations, automation chains' },
  { id: 'cto-innovation', name: 'Innovation Agent', role: 'Innovation', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'N', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cto-omega', description: 'Cross-industry breakthrough monitoring, ROI analysis' },
  { id: 'cto-update-auditor', name: 'Update Auditor', role: 'Update Scanning', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'U', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cto-omega', description: 'Security scanning, risk classification for updates' },
  { id: 'cto-update-architect', name: 'Update Architect', role: 'Update Planning', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'P', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cto-omega', description: 'Implementation planning, rollback strategies' },
  { id: 'cto-update-impl', name: 'Update Implementor', role: 'Update Execution', department: 'Technology', tier: 3, color: '#0066FF', avatar: 'X', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cto-omega', description: 'Update execution, safety checks, notification' },

  // CMO Nexus sub-agents
  { id: 'cmo-content', name: 'Content Strategist', role: 'Content', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'C', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cmo-nexus', description: 'LinkedIn posts, one-pagers, brand-aligned content' },
  { id: 'cmo-seo', name: 'SEO Expert', role: 'SEO', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'S', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cmo-nexus', description: 'Content optimization, keyword research, analytics' },
  { id: 'cmo-social', name: 'Social Media Manager', role: 'Social Media', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'M', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cmo-nexus', description: 'Scheduling, engagement, community management' },
  { id: 'cmo-linkedin', name: 'LinkedIn Agent', role: 'LinkedIn', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'L', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cmo-nexus', description: 'Platform-specific posting, networking, profile optimization' },
  { id: 'cmo-gamma', name: 'Gamma Agent', role: 'Presentations', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'G', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cmo-nexus', description: 'Presentation and deck creation via Gamma.app' },
  { id: 'cmo-research', name: 'Market Research Agent', role: 'Market Research', department: 'Marketing', tier: 3, color: '#FF00FF', avatar: 'R', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cmo-nexus', description: 'Market research, audience analysis, trend validation' },

  // COO Prime sub-agents
  { id: 'coo-process', name: 'Process Agent', role: 'Process Mapping', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'P', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'Business process mapping, optimization, documentation' },
  { id: 'coo-performance', name: 'Performance Agent', role: 'KPI Tracking', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'K', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'KPI tracking, dashboards, bottleneck detection' },
  { id: 'coo-workflow', name: 'Workflow Agent', role: 'Workflow Design', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'W', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'Multi-step workflow design, task dependencies' },
  { id: 'coo-procurement', name: 'Procurement Agent', role: 'Procurement', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'V', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'Vendor evaluation, license management, cost optimization' },
  { id: 'coo-automation', name: 'Automation Engineer', role: 'Automation', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'A', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'Workflows, cron jobs, system integrations' },
  { id: 'coo-scheduler', name: 'Scheduler', role: 'Scheduling', department: 'Operations', tier: 3, color: '#FF8800', avatar: 'T', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'coo-prime', description: 'Calendar management, reminders, time-sensitive operations' },

  // CLO Relay sub-agents
  { id: 'clo-comms', name: 'Communication Agent', role: 'Communications', department: 'Communications', tier: 3, color: '#9B59B6', avatar: 'E', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'clo-relay', description: 'Email drafting, message routing, stakeholder communication' },
  { id: 'clo-calendar', name: 'Calendar Agent', role: 'Calendar', department: 'Communications', tier: 3, color: '#9B59B6', avatar: 'C', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'clo-relay', description: 'Meeting scheduling, availability, timezone coordination' },
  { id: 'clo-contact', name: 'Contact Agent', role: 'CRM', department: 'Communications', tier: 3, color: '#9B59B6', avatar: 'B', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'clo-relay', description: 'CRM integration, contact management, relationship tracking' },
  { id: 'clo-briefer', name: 'Executive Briefer', role: 'Briefings', department: 'Communications', tier: 3, color: '#9B59B6', avatar: 'F', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'clo-relay', description: 'Meeting prep, summaries, executive communications' },
  { id: 'clo-coordinator', name: 'Cross-Dept Coordinator', role: 'Coordination', department: 'Communications', tier: 3, color: '#9B59B6', avatar: 'X', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'clo-relay', description: 'Inter-team priorities, dependency tracking, communication flows' },

  // CSO Venture sub-agents
  { id: 'cso-sales', name: 'Sales Agent', role: 'Sales', department: 'Sales', tier: 3, color: '#E74C3C', avatar: 'S', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cso-venture', description: 'Prospecting, outreach, lead qualification' },
  { id: 'cso-proposal', name: 'Proposal Agent', role: 'Proposals', department: 'Sales', tier: 3, color: '#E74C3C', avatar: 'P', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cso-venture', description: 'Proposal writing, RFP responses, pricing strategy' },
  { id: 'cso-pipeline', name: 'Pipeline Agent', role: 'Pipeline', department: 'Sales', tier: 3, color: '#E74C3C', avatar: 'F', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cso-venture', description: 'CRM management, deal tracking, forecast modeling' },

  // CFO Ledger sub-agents
  { id: 'cfo-revenue', name: 'Revenue Tracker', role: 'Revenue', department: 'Finance', tier: 3, color: '#2ECC71', avatar: 'R', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cfo-ledger', description: 'Revenue monitoring, invoice tracking, MRR/ARR analysis' },
  { id: 'cfo-margin', name: 'Margin Agent', role: 'Profitability', department: 'Finance', tier: 3, color: '#2ECC71', avatar: 'M', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cfo-ledger', description: 'Profitability analysis, cost allocation, unit economics' },
  { id: 'cfo-data', name: 'Data Agent', role: 'Financial Data', department: 'Finance', tier: 3, color: '#2ECC71', avatar: 'D', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cfo-ledger', description: 'Financial reporting, Excel modeling, P&L generation' },

  // CAO Sentinel sub-agents
  { id: 'cao-health', name: 'Health Check Agent', role: 'Health Monitoring', department: 'Audit', tier: 3, color: '#1ABC9C', avatar: 'H', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cao-sentinel', description: 'System uptime, endpoint health, service availability' },
  { id: 'cao-config', name: 'Config Audit Agent', role: 'Config Audit', department: 'Audit', tier: 3, color: '#1ABC9C', avatar: 'G', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cao-sentinel', description: 'Configuration drift detection, env variable validation' },
  { id: 'cao-report', name: 'Report Agent', role: 'Audit Reports', department: 'Audit', tier: 3, color: '#1ABC9C', avatar: 'T', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cao-sentinel', description: 'Daily/weekly audit reports, trend analysis, compliance docs' },
  { id: 'cao-security', name: 'Security Audit Agent', role: 'Security Audit', department: 'Audit', tier: 3, color: '#1ABC9C', avatar: 'Z', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cao-sentinel', description: 'Access control, vulnerability scanning, API key rotation tracking' },

  // CDO Prism sub-agents
  { id: 'cdo-brand', name: 'Brand Identity Creator', role: 'Brand Strategy', department: 'Design', tier: 3, color: '#F39C12', avatar: 'B', model: 'claude-sonnet-4-6', tokenBudget: 5000, parentId: 'cdo-prism', description: 'Brand strategy, visual identity, logo systems' },
  { id: 'cdo-system', name: 'Design System Architect', role: 'Design System', department: 'Design', tier: 3, color: '#F39C12', avatar: 'Y', model: 'claude-sonnet-4-6', tokenBudget: 5000, parentId: 'cdo-prism', description: 'Component libraries, design tokens, typography' },
  { id: 'cdo-patterns', name: 'UI Pattern Master', role: 'UI Patterns', department: 'Design', tier: 3, color: '#F39C12', avatar: 'U', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cdo-prism', description: 'Screen layouts, interaction patterns, responsive design' },
  { id: 'cdo-figma', name: 'Figma Expert', role: 'Design Specs', department: 'Design', tier: 3, color: '#F39C12', avatar: 'F', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cdo-prism', description: 'Design-to-spec, developer handoff, prototypes' },
  { id: 'cdo-assets', name: 'Marketing Asset Factory', role: 'Asset Production', department: 'Design', tier: 3, color: '#F39C12', avatar: 'M', model: 'claude-haiku-4-5', tokenBudget: 5000, parentId: 'cdo-prism', description: 'Campaign visuals, social assets, 47+ asset types' },
  { id: 'cdo-presentation', name: 'Presentation Designer', role: 'Presentations', department: 'Design', tier: 3, color: '#F39C12', avatar: 'K', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cdo-prism', description: 'Keynote-level decks, pitch materials, investor presentations' },
  { id: 'cdo-trends', name: 'Trend Synthesizer', role: 'Trend Analysis', department: 'Design', tier: 3, color: '#F39C12', avatar: 'T', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cdo-prism', description: 'Design trend analysis, competitor visual audits' },
  { id: 'cdo-critique', name: 'Critique Partner', role: 'Design Review', department: 'Design', tier: 3, color: '#F39C12', avatar: 'Q', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cdo-prism', description: 'Design review, heuristic evaluation' },
  { id: 'cdo-a11y', name: 'Accessibility Auditor', role: 'Accessibility', department: 'Design', tier: 3, color: '#F39C12', avatar: 'W', model: 'claude-haiku-4-5', tokenBudget: 3000, parentId: 'cdo-prism', description: 'WCAG 2.2 AA compliance, contrast, keyboard nav' },
  { id: 'cdo-remotion', name: 'Video Production Agent', role: 'Video', department: 'Design', tier: 3, color: '#F39C12', avatar: 'V', model: 'claude-sonnet-4-6', tokenBudget: 5000, parentId: 'cdo-prism', description: 'Remotion video generation, motion graphics' },
]

/** All Ultron agents in a single flat array */
export const ALL_ULTRON_AGENTS: readonly UltronAgentDefinition[] = [
  COMMANDER,
  ...C_SUITE,
  ...SPECIALISTS,
]

/** Get agents by tier */
export function getAgentsByTier(tier: 1 | 2 | 3): readonly UltronAgentDefinition[] {
  return ALL_ULTRON_AGENTS.filter(a => a.tier === tier)
}

/** Get agents by department */
export function getAgentsByDepartment(department: string): readonly UltronAgentDefinition[] {
  return ALL_ULTRON_AGENTS.filter(a => a.department === department)
}

/** Get sub-agents of a parent */
export function getSubAgents(parentId: string): readonly UltronAgentDefinition[] {
  return ALL_ULTRON_AGENTS.filter(a => a.parentId === parentId)
}

/** Get the routing table for task delegation */
export const ROUTING_TABLE: ReadonlyArray<{ readonly keywords: readonly string[]; readonly routeTo: string }> = [
  { keywords: ['sales', 'prospect', 'outreach', 'proposal', 'deal', 'pipeline', 'close', 'lead'], routeTo: 'cso-venture' },
  { keywords: ['revenue', 'margin', 'excel', 'p&l', 'tracking', 'financials', 'invoice', 'budget'], routeTo: 'cfo-ledger' },
  { keywords: ['code', 'script', 'bug', 'build', 'deploy', 'docker', 'n8n', 'skill', 'api'], routeTo: 'cto-omega' },
  { keywords: ['research', 'find', 'who is', 'market', 'intel', 'news', 'look up', 'analyze'], routeTo: 'cio-alpha' },
  { keywords: ['post', 'linkedin', 'content', 'article', 'brand', 'deck', 'gamma', 'seo'], routeTo: 'cmo-nexus' },
  { keywords: ['email', 'meeting', 'brief', 'schedule', 'contact', 'coordinate', 'calendar'], routeTo: 'clo-relay' },
  { keywords: ['operations', 'improve', 'optimize', 'workflow', 'performance', 'automate'], routeTo: 'coo-prime' },
  { keywords: ['audit', 'health', 'status', 'check', 'report', 'config', 'security scan'], routeTo: 'cao-sentinel' },
  { keywords: ['design', 'brand identity', 'ui', 'video', 'figma', 'presentation', 'wcag'], routeTo: 'cdo-prism' },
]

/** Route a task to the appropriate department based on keywords */
export function routeTask(taskText: string): string {
  const lower = taskText.toLowerCase()
  for (const route of ROUTING_TABLE) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route.routeTo
    }
  }
  return 'ultron'
}
