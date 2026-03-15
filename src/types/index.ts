export interface WebSocketMessage {
  type: string
  data: any
  timestamp?: number
}

export interface Session {
  id: string
  key: string
  kind: string
  age: string
  model: string
  tokens: string
  flags: string[]
  active: boolean
  label?: string
  currentTask?: string
  lastActivity?: number
  startTime?: number
  messageCount?: number
  cost?: number
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

// Database row type matching the claude_sessions table schema.
// Distinct from Session (UI display type used by upstream panels).
export interface ClaudeSessionRow {
  id: number
  session_id: string
  project_slug: string
  project_path?: string | null
  model?: string
  git_branch?: string
  user_messages: number
  assistant_messages: number
  tool_uses: number
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  first_message_at?: string
  last_message_at?: string
  last_user_prompt?: string | null
  is_active: number // SQLite boolean (0|1)
  scanned_at: number
  created_at: number
  updated_at: number
  // Phase migration extensions (added by phase_029+)
  tool_success_count?: number
  tool_error_count?: number
  total_loc_delta?: number
  stability_score?: number
  is_anomaly?: number
  loc_by_language?: string
  tool_timeline?: string
  alert_status?: string
  is_sidechain?: number
  parent_session_id?: string | null
  intent_task?: string | null
  history_stability?: string
  area?: string
  error_density?: number
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