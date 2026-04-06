// Shared types for agent-detail sub-components
import type { JsonValue } from '@/store/shared-types'

export interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
  working_memory?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  /** Arbitrary agent config — model.primary is the canonical model override */
  config?: JsonValue
  /** Raw model field — may be a string alias or an object with a primary key */
  model?: string | Record<string, unknown>
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

/** All agent fields managed by the edit form (shared across detail tabs) */
export interface AgentFormData {
  role: string
  model: string
  session_key: string
  soul_content: string
  working_memory: string
}

export interface WorkItem {
  type: string
  count: number
  items: JsonValue[]
}

export interface HeartbeatResponse {
  status: 'HEARTBEAT_OK' | 'WORK_ITEMS_FOUND'
  agent: string
  checked_at: number
  work_items?: WorkItem[]
  total_items?: number
  message?: string
}

export interface SoulTemplate {
  name: string
  description: string
  size: number
}

export interface FileEntry {
  name: string
  exists: boolean
  content: string
}

export interface ChannelAccountInfo {
  id?: string
  connected?: boolean
  running?: boolean
  configured?: boolean
  enabled?: boolean
  probe?: { ok?: boolean }
}

export interface ChannelEntryInfo {
  id: string
  label: string
  accounts: ChannelAccountInfo[]
}

export interface AgentCronJob {
  name: string
  description?: string
  agentId?: string
  schedule?: string
  cron?: string
  enabled?: boolean
  lastRun?: string | number | null
  nextRun?: string | number | null
  sessionTarget?: string
  state?: string
  payload?: JsonValue
}
