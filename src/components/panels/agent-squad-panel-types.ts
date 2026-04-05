// Types and constants used exclusively by the simple agent-squad-panel family.
// These differ from the Phase-3 agent-squad/ subdirectory types intentionally:
// this panel talks directly to /api/agents and owns its own local Agent shape.

export interface AgentTaskStats {
  total: number
  assigned: number
  in_progress: number
  completed: number
}

export interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  // config is untyped in the API response — keep as unknown and cast at point of use
  config?: unknown
  taskStats?: AgentTaskStats
}

export const statusColors: Readonly<Record<string, string>> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

export const statusIcons: Readonly<Record<string, string>> = {
  offline: '⚫',
  idle: '🟢',
  busy: '🟡',
  error: '🔴',
}
