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