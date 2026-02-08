'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// Enhanced types for Mission Control
export interface Session {
  id: string
  key: string
  kind: string
  age: string
  model: string
  tokens: string
  flags: string[]
  active: boolean
  startTime?: number
  lastActivity?: number
  messageCount?: number
  cost?: number
}

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: any
}

export interface CronJob {
  name: string
  schedule: string
  command: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
}

export interface SpawnRequest {
  id: string
  task: string
  model: string
  label: string
  timeoutSeconds: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: number
  completedAt?: number
  result?: string
  error?: string
}

export interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

export interface TokenUsage {
  model: string
  sessionId: string
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
}

export interface ModelConfig {
  alias: string
  name: string
  provider: string
  description: string
  costPer1k: number
}

// Mission Control Phase 2 Types
export interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
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
  config?: any
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

export interface Activity {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data?: any
  created_at: number
  entity?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
}

export interface Notification {
  id: number
  recipient: string
  type: string
  title: string
  message: string
  source_type?: string
  source_id?: number
  read_at?: number
  delivered_at?: number
  created_at: number
  source?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
}

export interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
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
  pendingStatus?: 'sending' | 'sent' | 'failed'
}

export interface Conversation {
  id: string
  name?: string
  participants: string[]
  lastMessage?: ChatMessage
  unreadCount: number
  updatedAt: number
}

export interface StandupReport {
  date: string
  generatedAt: string
  summary: {
    totalAgents: number
    totalCompleted: number
    totalInProgress: number
    totalAssigned: number
    totalReview: number
    totalBlocked: number
    totalActivity: number
    overdue: number
  }
  agentReports: Array<{
    agent: {
      name: string
      role: string
      status: string
      last_seen?: number
      last_activity?: string
    }
    completedToday: Task[]
    inProgress: Task[]
    assigned: Task[]
    review: Task[]
    blocked: Task[]
    activity: {
      actionCount: number
      commentsCount: number
    }
  }>
  teamAccomplishments: Task[]
  teamBlockers: Task[]
  overdueTasks: Task[]
}

export interface ConnectionStatus {
  isConnected: boolean
  url: string
  lastConnected?: Date
  reconnectAttempts: number
  latency?: number
  sseConnected?: boolean
}

interface MissionControlStore {
  // WebSocket & Connection
  connection: ConnectionStatus
  lastMessage: any
  setConnection: (connection: Partial<ConnectionStatus>) => void
  setLastMessage: (message: any) => void

  // Mission Control Phase 2 - Tasks
  tasks: Task[]
  selectedTask: Task | null
  setTasks: (tasks: Task[]) => void
  setSelectedTask: (task: Task | null) => void
  addTask: (task: Task) => void
  updateTask: (taskId: number, updates: Partial<Task>) => void
  deleteTask: (taskId: number) => void

  // Mission Control Phase 2 - Agents
  agents: Agent[]
  selectedAgent: Agent | null
  setAgents: (agents: Agent[]) => void
  setSelectedAgent: (agent: Agent | null) => void
  addAgent: (agent: Agent) => void
  updateAgent: (agentId: number, updates: Partial<Agent>) => void
  deleteAgent: (agentId: number) => void

  // Mission Control Phase 2 - Activities
  activities: Activity[]
  setActivities: (activities: Activity[]) => void
  addActivity: (activity: Activity) => void

  // Mission Control Phase 2 - Notifications
  notifications: Notification[]
  unreadNotificationCount: number
  setNotifications: (notifications: Notification[]) => void
  addNotification: (notification: Notification) => void
  markNotificationRead: (notificationId: number) => void
  markAllNotificationsRead: () => void

  // Mission Control Phase 2 - Comments
  taskComments: Record<number, Comment[]>
  setTaskComments: (taskId: number, comments: Comment[]) => void
  addTaskComment: (taskId: number, comment: Comment) => void

  // Mission Control Phase 2 - Standup
  standupReports: StandupReport[]
  currentStandupReport: StandupReport | null
  setStandupReports: (reports: StandupReport[]) => void
  setCurrentStandupReport: (report: StandupReport | null) => void

  // Sessions
  sessions: Session[]
  selectedSession: string | null
  setSessions: (sessions: Session[]) => void
  setSelectedSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void

  // Logs
  logs: LogEntry[]
  logFilters: {
    level?: string
    source?: string
    session?: string
    search?: string
  }
  addLog: (log: LogEntry) => void
  setLogFilters: (filters: Partial<{
    level?: string
    source?: string
    session?: string
    search?: string
  }>) => void
  clearLogs: () => void

  // Agent Spawning
  spawnRequests: SpawnRequest[]
  addSpawnRequest: (request: SpawnRequest) => void
  updateSpawnRequest: (id: string, updates: Partial<SpawnRequest>) => void

  // Cron Management
  cronJobs: CronJob[]
  setCronJobs: (jobs: CronJob[]) => void
  updateCronJob: (name: string, updates: Partial<CronJob>) => void

  // Memory Browser
  memoryFiles: MemoryFile[]
  selectedMemoryFile: string | null
  memoryContent: string | null
  setMemoryFiles: (files: MemoryFile[]) => void
  setSelectedMemoryFile: (path: string | null) => void
  setMemoryContent: (content: string | null) => void

  // Token Usage & Cost Tracking
  tokenUsage: TokenUsage[]
  addTokenUsage: (usage: TokenUsage) => void
  getUsageByModel: (timeframe: 'day' | 'week' | 'month') => Record<string, number>
  getTotalCost: (timeframe: 'day' | 'week' | 'month') => number

  // Model Configuration
  availableModels: ModelConfig[]
  setAvailableModels: (models: ModelConfig[]) => void

  // Agent Chat
  chatMessages: ChatMessage[]
  conversations: Conversation[]
  activeConversation: string | null
  chatInput: string
  isSendingMessage: boolean
  chatPanelOpen: boolean
  setChatMessages: (messages: ChatMessage[]) => void
  addChatMessage: (message: ChatMessage) => void
  replacePendingMessage: (tempId: number, message: ChatMessage) => void
  updatePendingMessage: (tempId: number, updates: Partial<ChatMessage>) => void
  removePendingMessage: (tempId: number) => void
  setConversations: (conversations: Conversation[]) => void
  setActiveConversation: (conversationId: string | null) => void
  setChatInput: (input: string) => void
  setIsSendingMessage: (loading: boolean) => void
  setChatPanelOpen: (open: boolean) => void
  markConversationRead: (conversationId: string) => void

  // UI State
  activeTab: string
  sidebarCollapsed: boolean
  setActiveTab: (tab: string) => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useMissionControl = create<MissionControlStore>()(
  subscribeWithSelector((set, get) => ({
    // Connection state
    connection: {
      isConnected: false,
      url: '',
      reconnectAttempts: 0
    },
    lastMessage: null,
    setConnection: (connection) =>
      set((state) => ({ 
        connection: { ...state.connection, ...connection } 
      })),
    setLastMessage: (message) => set({ lastMessage: message }),

    // Sessions
    sessions: [],
    selectedSession: null,
    setSessions: (sessions) => set({ sessions }),
    setSelectedSession: (sessionId) => set({ selectedSession: sessionId }),
    updateSession: (sessionId, updates) =>
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, ...updates } : session
        ),
      })),

    // Logs
    logs: [],
    logFilters: {},
    addLog: (log) =>
      set((state) => {
        // Check if log already exists to prevent duplicates
        const existingLogIndex = state.logs.findIndex(existingLog => existingLog.id === log.id)
        if (existingLogIndex !== -1) {
          // Update existing log
          const updatedLogs = [...state.logs]
          updatedLogs[existingLogIndex] = log
          return { logs: updatedLogs }
        }
        // Add new log at the beginning (newest first)
        return {
          logs: [log, ...state.logs].slice(0, 1000), // Keep last 1000 logs
        }
      }),
    setLogFilters: (filters) =>
      set((state) => ({
        logFilters: { ...state.logFilters, ...filters },
      })),
    clearLogs: () => set({ logs: [] }),

    // Agent Spawning
    spawnRequests: [],
    addSpawnRequest: (request) =>
      set((state) => ({
        spawnRequests: [request, ...state.spawnRequests],
      })),
    updateSpawnRequest: (id, updates) =>
      set((state) => ({
        spawnRequests: state.spawnRequests.map((req) =>
          req.id === id ? { ...req, ...updates } : req
        ),
      })),

    // Cron Management
    cronJobs: [],
    setCronJobs: (jobs) => set({ cronJobs: jobs }),
    updateCronJob: (name, updates) =>
      set((state) => ({
        cronJobs: state.cronJobs.map((job) =>
          job.name === name ? { ...job, ...updates } : job
        ),
      })),

    // Memory Browser
    memoryFiles: [],
    selectedMemoryFile: null,
    memoryContent: null,
    setMemoryFiles: (files) => set({ memoryFiles: files }),
    setSelectedMemoryFile: (path) => set({ selectedMemoryFile: path }),
    setMemoryContent: (content) => set({ memoryContent: content }),

    // Token Usage
    tokenUsage: [],
    addTokenUsage: (usage) =>
      set((state) => ({
        tokenUsage: [...state.tokenUsage, usage],
      })),
    getUsageByModel: (timeframe) => {
      const { tokenUsage } = get()
      const now = new Date()
      let cutoff: Date

      switch (timeframe) {
        case 'day':
          cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        case 'week':
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case 'month':
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          cutoff = new Date(0)
      }

      return tokenUsage
        .filter((usage) => new Date(usage.date) >= cutoff)
        .reduce((acc, usage) => {
          acc[usage.model] = (acc[usage.model] || 0) + usage.totalTokens
          return acc
        }, {} as Record<string, number>)
    },
    getTotalCost: (timeframe) => {
      const { tokenUsage } = get()
      const now = new Date()
      let cutoff: Date

      switch (timeframe) {
        case 'day':
          cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        case 'week':
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case 'month':
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          cutoff = new Date(0)
      }

      return tokenUsage
        .filter((usage) => new Date(usage.date) >= cutoff)
        .reduce((acc, usage) => acc + usage.cost, 0)
    },

    // Model Configuration
    availableModels: [
      { alias: 'haiku', name: 'anthropic/claude-3-5-haiku-latest', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 0.25 },
      { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0 },
      { alias: 'opus', name: 'anthropic/claude-opus-4-5', provider: 'anthropic', description: 'Premium quality', costPer1k: 15.0 },
      { alias: 'deepseek', name: 'ollama/deepseek-r1:14b', provider: 'ollama', description: 'Local reasoning (free)', costPer1k: 0.0 },
      { alias: 'groq-fast', name: 'groq/llama-3.1-8b-instant', provider: 'groq', description: '840 tok/s, ultra fast', costPer1k: 0.05 },
      { alias: 'groq', name: 'groq/llama-3.3-70b-versatile', provider: 'groq', description: 'Fast + quality balance', costPer1k: 0.59 },
      { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1k: 1.0 },
      { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective (1/10th price), strong coding', costPer1k: 0.3 },
    ],
    setAvailableModels: (models) => set({ availableModels: models }),

    // UI State
    activeTab: 'overview',
    sidebarCollapsed: false,
    setActiveTab: (tab) => set({ activeTab: tab }),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

    // Mission Control Phase 2 - Tasks
    tasks: [],
    selectedTask: null,
    setTasks: (tasks) => set({ tasks }),
    setSelectedTask: (task) => set({ selectedTask: task }),
    addTask: (task) =>
      set((state) => ({
        tasks: [task, ...state.tasks]
      })),
    updateTask: (taskId, updates) =>
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === taskId ? { ...task, ...updates } : task
        ),
        selectedTask: state.selectedTask?.id === taskId
          ? { ...state.selectedTask, ...updates }
          : state.selectedTask
      })),
    deleteTask: (taskId) =>
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== taskId),
        selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask
      })),

    // Mission Control Phase 2 - Agents
    agents: [],
    selectedAgent: null,
    setAgents: (agents) => set({ agents }),
    setSelectedAgent: (agent) => set({ selectedAgent: agent }),
    addAgent: (agent) =>
      set((state) => ({
        agents: [agent, ...state.agents]
      })),
    updateAgent: (agentId, updates) =>
      set((state) => ({
        agents: state.agents.map((agent) =>
          agent.id === agentId ? { ...agent, ...updates } : agent
        ),
        selectedAgent: state.selectedAgent?.id === agentId
          ? { ...state.selectedAgent, ...updates }
          : state.selectedAgent
      })),
    deleteAgent: (agentId) =>
      set((state) => ({
        agents: state.agents.filter((agent) => agent.id !== agentId),
        selectedAgent: state.selectedAgent?.id === agentId ? null : state.selectedAgent
      })),

    // Mission Control Phase 2 - Activities
    activities: [],
    setActivities: (activities) => set({ activities }),
    addActivity: (activity) =>
      set((state) => ({
        activities: [activity, ...state.activities].slice(0, 1000) // Keep last 1000
      })),

    // Mission Control Phase 2 - Notifications
    notifications: [],
    unreadNotificationCount: 0,
    setNotifications: (notifications) =>
      set({
        notifications,
        unreadNotificationCount: notifications.filter(n => !n.read_at).length
      }),
    addNotification: (notification) =>
      set((state) => ({
        notifications: [notification, ...state.notifications],
        unreadNotificationCount: state.unreadNotificationCount + 1
      })),
    markNotificationRead: (notificationId) =>
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.id === notificationId 
            ? { ...notification, read_at: Math.floor(Date.now() / 1000) }
            : notification
        ),
        unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1)
      })),
    markAllNotificationsRead: () =>
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.read_at ? notification : { ...notification, read_at: Math.floor(Date.now() / 1000) }
        ),
        unreadNotificationCount: 0
      })),

    // Mission Control Phase 2 - Comments
    taskComments: {},
    setTaskComments: (taskId, comments) =>
      set((state) => ({
        taskComments: { ...state.taskComments, [taskId]: comments }
      })),
    addTaskComment: (taskId, comment) =>
      set((state) => ({
        taskComments: {
          ...state.taskComments,
          [taskId]: [comment, ...(state.taskComments[taskId] || [])]
        }
      })),

    // Agent Chat
    chatMessages: [],
    conversations: [],
    activeConversation: null,
    chatInput: '',
    isSendingMessage: false,
    chatPanelOpen: false,
    setChatMessages: (messages) => set({ chatMessages: messages.slice(-500) }),
    addChatMessage: (message) =>
      set((state) => {
        // Deduplicate: skip if a message with the same server ID already exists
        if (message.id > 0 && state.chatMessages.some(m => m.id === message.id)) {
          return state
        }
        const messages = [...state.chatMessages, message].slice(-500)
        const conversations = state.conversations.map((conv) =>
          conv.id === message.conversation_id
            ? { ...conv, lastMessage: message, updatedAt: message.created_at }
            : conv
        )
        return { chatMessages: messages, conversations }
      }),
    replacePendingMessage: (tempId, message) =>
      set((state) => ({
        chatMessages: state.chatMessages.map(m =>
          m.id === tempId ? { ...message, pendingStatus: 'sent' } : m
        ),
      })),
    updatePendingMessage: (tempId, updates) =>
      set((state) => ({
        chatMessages: state.chatMessages.map(m =>
          m.id === tempId ? { ...m, ...updates } : m
        ),
      })),
    removePendingMessage: (tempId) =>
      set((state) => ({
        chatMessages: state.chatMessages.filter(m => m.id !== tempId),
      })),
    setConversations: (conversations) => set({ conversations }),
    setActiveConversation: (conversationId) => set({ activeConversation: conversationId }),
    setChatInput: (input) => set({ chatInput: input }),
    setIsSendingMessage: (loading) => set({ isSendingMessage: loading }),
    setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
    markConversationRead: (conversationId) =>
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId
            ? { ...conv, unreadCount: 0 }
            : conv
        ),
        chatMessages: state.chatMessages.map((msg) =>
          msg.conversation_id === conversationId && !msg.read_at
            ? { ...msg, read_at: Math.floor(Date.now() / 1000) }
            : msg
        )
      })),

    // Mission Control Phase 2 - Standup
    standupReports: [],
    currentStandupReport: null,
    setStandupReports: (reports) => set({ standupReports: reports }),
    setCurrentStandupReport: (report) => set({ currentStandupReport: report }),
  }))
)
