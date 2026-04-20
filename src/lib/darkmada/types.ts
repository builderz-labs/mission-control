/**
 * DarkMada — canonical type definitions for the DarkMada control plane.
 * Source-of-truth shapes consumed by every DarkMada panel and the System Atlas.
 */

export type AgentId =
  | 'helmy'
  | 'thinky'
  | 'skywalker'
  | 'velma'
  | 'dr-strange'
  | 'seccy'

export type AgentRole =
  | 'executive'
  | 'orchestrator'
  | 'engineering'
  | 'research'
  | 'memory'
  | 'security'

export interface AgentDefinition {
  id: AgentId
  name: string
  role: AgentRole
  title: string
  reportsTo: AgentId | null
  mission: string
  primaryModel: string
  fallbackModel: string
  surfaces: string[]
  status: 'online' | 'idle' | 'offline'
  accent: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson'
}

export type AccountId = 'jackson' | 'mainframe' | 'spiderman'

export interface MachineAccount {
  id: AccountId
  label: string
  purpose: string
  responsibilities: string[]
}

export interface ComputeNode {
  id: string
  label: string
  kind: 'laptop' | 'server' | 'edge' | 'future'
  status: 'live' | 'planned'
  accounts: AccountId[]
  notes: string
}

export type ModelTier = 'local' | 'cloud-frontier' | 'cloud-fast'

export interface ModelEntry {
  id: string
  label: string
  provider: 'ollama' | 'openai' | 'anthropic'
  tier: ModelTier
  bestFor: string
  cost: 'free' | '$' | '$$' | '$$$'
}

export interface MCPService {
  id: string
  label: string
  responsibility: string
  consumers: AgentId[]
  source: 'truth' | 'mirror' | 'cache'
}

export interface AssemblyLane {
  id: string
  label: string
  trigger: string
  steps: string[]
  owner: AgentId
  status: 'live' | 'draft' | 'paused'
}

export interface VaultTable {
  name: string
  purpose: string
  truthSource: boolean
  vectorized: boolean
}

export interface NetworkSegment {
  id: string
  label: string
  cidr: string
  trust: 'founder' | 'server' | 'edge' | 'guest'
  members: string[]
}

export interface BriefingItem {
  id: string
  title: string
  source: AgentId
  priority: 'p0' | 'p1' | 'p2'
  body: string
  pendingApproval?: boolean
}
