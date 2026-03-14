export interface WebSocketMessage {
  type: string
  data: any
  timestamp?: number
}

export interface Session {
  id: string // Maps to session_id
  session_id: string
  project_slug: string
  model: string
  tool_uses: number
  tool_success_count: number
  tool_error_count: number
  total_loc_delta: number
  stability_score: number
  estimated_cost: number
  total_tokens: number
  last_message_at: string
  last_user_prompt: string | null
  alert_status: 'nominal' | 'warning' | 'critical'
  user_messages: number
  assistant_messages: number
  is_active: boolean
  
  // Legacy/Optional properties for backward compatibility
  active?: boolean
  label?: string
  key: string
  flags?: string[]
  kind?: string
  age?: string
  tokens?: string | number
  cost?: number
  locDelta?: number
  toolSuccesses?: number
  toolErrors?: number
  projectSlug?: string
  stabilityScore?: number
  locByLanguage?: string | Record<string, number>
  loc_by_language?: string
  tool_timeline?: string | Array<{ name: string; status: 'success' | 'error'; timestamp: string }>
  is_sidechain?: boolean
  parent_session_id?: string | null
  project_path?: string | null
  area?: 'backend' | 'frontend' | 'infra' | 'unknown'
  intent_task?: string | null
  is_anomaly?: boolean
}

export interface AgentStatus {
  id: string
  name: string
  status: 'active' | 'idle' | 'error' | 'offline'
  model: string
  uptime: number
  messageCount: number
  lastActivity: Date
}

export interface GitHealth {
  branch: string | null
  commitHash: string | null
  isDirty: boolean
  aheadBy: number
  behindBy: number
  untrackedCount: number
  stagedCount: number
  lastCommitAt: number | null
}

export interface RoadmapTask {
  name: string
  status: 'todo' | 'in_progress' | 'done'
  indent: number
}

export interface RoadmapPhase {
  name: string
  status: 'todo' | 'in_progress' | 'done'
  progress: number
  tasks: RoadmapTask[]
}

export interface ProjectHealth {
  name: string
  path: string
  status: 'active' | 'inactive' | 'unknown'
  progress: number
  lastUpdated: string | null
  tasks: {
    total: number
    completed: number
  }
  git?: GitHealth
  activeSessionCount?: number
  activeSessionIds?: string[]
  roadmapFocus?: string
  currentPhase?: string
  roadmap?: RoadmapPhase[]
}

export interface ConnectionState {
  isConnected: boolean
  url: string
  lastConnected?: Date
  reconnectAttempts: number
}

export interface DashboardStats {
  totalSessions: number
  activeSessions: number
  totalMessages: number
  uptime: number
  errors: number
  totalLocDelta?: number
}

export interface Agent {
  id: string
  name: string
  type: 'main' | 'subagent' | 'cron' | 'group'
  status: AgentStatus['status']
  model: string
  session?: Session
  position?: { x: number; y: number }
}

export interface FlowNode {
  id: string
  type: string
  data: {
    label: string
    agent: Agent
    status: string
  }
  position: { x: number; y: number }
  style?: React.CSSProperties
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  type?: string
  animated?: boolean
  style?: React.CSSProperties
}

export interface ChatMessage {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string | null
  content: string
  message_type: 'text' | 'system' | 'handoff' | 'status' | 'command'
  metadata?: any
  read_at?: number
  created_at: number
}

export interface Conversation {
  id: string
  name?: string
  participants: string[]
  lastMessage?: ChatMessage
  unreadCount: number
  updatedAt: number
}