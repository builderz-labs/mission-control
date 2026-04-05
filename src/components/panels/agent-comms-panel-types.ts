// Types, constants, and static data for the AgentCommsPanel feature.
// Mirrors the OpenClaw TUI FeedCategory taxonomy.

export const COORDINATOR_AGENT = (process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').toLowerCase()

// ── Feed categories ──

export type FeedCategory = 'chat' | 'tools' | 'trace' | 'system' | 'safety'
export type FeedFilter = 'all' | FeedCategory

export interface FeedEvent {
  readonly id: string
  readonly ts: number
  readonly category: FeedCategory
  readonly source: string
  readonly message: string
  readonly level?: 'info' | 'warn' | 'error' | 'debug'
  readonly data?: unknown
}

// ── DB-backed comms types ──

export interface CommsMessage {
  readonly id: number
  readonly conversation_id: string
  readonly from_agent: string
  readonly to_agent: string
  readonly content: string
  readonly message_type: string
  readonly metadata: unknown
  readonly created_at: number
}

export interface CommsData {
  readonly messages: CommsMessage[]
  readonly total: number
  readonly graph: {
    readonly edges: ReadonlyArray<{
      readonly from_agent: string
      readonly to_agent: string
      readonly message_count: number
      readonly last_message_at: number
    }>
    readonly agentStats: ReadonlyArray<{ readonly agent: string; readonly sent: number; readonly received: number }>
  }
  readonly source?: {
    readonly mode: 'seeded' | 'live' | 'mixed' | 'empty'
    readonly seededCount: number
    readonly liveCount: number
  }
}

export interface ActivityRecord {
  readonly id: number
  readonly type: string
  readonly actor: string
  readonly description: string
  readonly data: unknown
  readonly created_at: number
}

export interface Target {
  readonly type: 'agent' | 'session'
  readonly name: string
  readonly sessionKey?: string
}

// ── Agent identity map (matches openclaw.json) ──

export type AgentIdentity = { readonly color: string; readonly emoji: string; readonly label: string }

export const AGENT_IDENTITY: Readonly<Record<string, AgentIdentity>> = {
  [COORDINATOR_AGENT]: { color: '#a78bfa', emoji: '🧭', label: 'Coordinator' },
  builder:        { color: '#60a5fa', emoji: '🛠️', label: 'Builder' },
  research:       { color: '#4ade80', emoji: '🔬', label: 'Research' },
  content:        { color: '#818cf8', emoji: '✏️', label: 'Content' },
  ops:            { color: '#fb923c', emoji: '⚡', label: 'Ops' },
  quant:          { color: '#facc15', emoji: '📈', label: 'Quant' },
  aegis:          { color: '#f87171', emoji: '🧪', label: 'Aegis' },
  reviewer:       { color: '#2dd4bf', emoji: '🧪', label: 'Reviewer' },
  design:         { color: '#f472b6', emoji: '🎨', label: 'Design' },
  seo:            { color: '#22d3ee', emoji: '🔎', label: 'SEO' },
  security:       { color: '#fb7185', emoji: '🛡️', label: 'Security' },
  ai:             { color: '#8b5cf6', emoji: '🤖', label: 'AI' },
  'frontend-dev': { color: '#38bdf8', emoji: '🧩', label: 'Frontend Dev' },
  'backend-dev':  { color: '#34d399', emoji: '⚙️', label: 'Backend Dev' },
  'solana-dev':   { color: '#fbbf24', emoji: '🦀', label: 'Solana Dev' },
  gateway:        { color: '#94a3b8', emoji: '🌐', label: 'Gateway' },
  system:         { color: '#64748b', emoji: '⚙️', label: 'System' },
  websocket:      { color: '#a78bfa', emoji: '🔌', label: 'WebSocket' },
}

export const CATEGORY_META: Readonly<Record<FeedCategory, { readonly label: string; readonly color: string }>> = {
  chat:   { label: 'chat',   color: '#a78bfa' },
  tools:  { label: 'tools',  color: '#22d3ee' },
  trace:  { label: 'trace',  color: '#94a3b8' },
  system: { label: 'system', color: '#64748b' },
  safety: { label: 'safety', color: '#f87171' },
}

export const FILTER_OPTIONS: ReadonlyArray<{ readonly value: FeedFilter; readonly label: string }> = [
  { value: 'all',    label: 'All' },
  { value: 'chat',   label: 'Chat' },
  { value: 'tools',  label: 'Tools' },
  { value: 'trace',  label: 'Trace' },
  { value: 'system', label: 'System' },
  { value: 'safety', label: 'Safety' },
]
