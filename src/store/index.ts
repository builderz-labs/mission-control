'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { MODEL_CATALOG } from '@/lib/models'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined }
type DashboardLayoutUpdater = string[] | null | ((current: string[] | null) => string[] | null)

// Enhanced types for Mission Control
export interface Session {
  id: string
  key: string
  agent?: string
  channel?: string
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
  label?: string
}

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: JsonValue
}

export interface CronJob {
  id?: string
  name: string
  schedule: string
  command: string
  model?: string
  agentId?: string
  timezone?: string
  delivery?: string
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
  cacheReadTokens?: number
  cacheWriteTokens?: number
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
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done' | 'awaiting_owner'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  project_id?: number
  project_ticket_no?: number
  project_name?: string
  project_prefix?: string
  ticket_ref?: string
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  outcome?: 'success' | 'failed' | 'partial' | 'abandoned'
  error_message?: string
  resolution?: string
  feedback_rating?: number
  feedback_notes?: string
  retry_count?: number
  completed_at?: number
  tags?: string[]
  metadata?: JsonValue
  github_issue_number?: number
  github_repo?: string
  github_synced_at?: number
  github_branch?: string
  github_pr_number?: number
  github_pr_state?: string
}

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
  hidden?: number
  config?: JsonValue
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    quality_review: number
    done: number
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
  data?: JsonValue
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

export interface ChatAttachment {
  name: string
  type: string
  size: number
  dataUrl: string
}

export interface ChatMessage {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string | null
  content: string
  message_type: 'text' | 'system' | 'handoff' | 'status' | 'command' | 'tool_call'
  metadata?: JsonValue
  attachments?: ChatAttachment[]
  read_at?: number
  created_at: number
  pendingStatus?: 'sending' | 'sent' | 'failed'
}

export interface Conversation {
  id: string
  name?: string
  kind?: string
  source?: 'chat' | 'session'
  session?: {
    prefKey?: string
    sessionId: string
    sessionKey?: string
    sessionKind: 'claude-code' | 'codex-cli' | 'hermes' | 'gateway'
    agent?: string
    displayName?: string
    colorTag?: string
    model?: string
    tokens?: string
    workingDir?: string | null
    lastUserPrompt?: string | null
    active?: boolean
    age?: string
  }
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

export interface CurrentUser {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id?: number
  tenant_id?: number
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
}

// Billing/provisioning entity that can own multiple Mission Control workspaces.
export interface Tenant {
  id: number
  slug: string
  display_name: string
  status: string
  linux_user: string
  gateway_port?: number | null
  owner_gateway?: string
}

export interface OsUser {
  username: string
  uid: number
  home_dir: string
  shell: string
  linked_tenant_id: number | null
  has_claude: boolean
  has_codex: boolean
  has_openclaw: boolean
  is_process_owner: boolean
}

export interface Project {
  id: number
  name: string
  slug: string
  description?: string
  ticket_prefix: string
  status: string
  github_repo?: string
  deadline?: number
  color?: string
  task_count?: number
  assigned_agents?: string[]
  github_sync_enabled?: boolean
  github_labels_initialized?: boolean
  github_default_branch?: string
}

export interface ConnectionStatus {
  isConnected: boolean
  url: string
  lastConnected?: Date
  reconnectAttempts: number
  latency?: number
  sseConnected?: boolean
}

export interface ExecApprovalRequest {
  id: string
  sessionId: string
  agentName?: string
  toolName: string
  toolArgs: Record<string, any>
  command?: string
  cwd?: string
  host?: string
  resolvedPath?: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  expiresAt?: number
  status: 'pending' | 'approved' | 'denied' | 'expired'
}

interface MissionControlStore {
  // Dashboard Mode (local vs full gateway)
  dashboardMode: 'full' | 'local'
  gatewayAvailable: boolean
  localSessionsAvailable: boolean
  bannerDismissed: boolean
  capabilitiesChecked: boolean
  bootComplete: boolean
  subscription: { type: string; provider?: string; rateLimitTier?: string } | null
  defaultOrgName: string
  setDashboardMode: (mode: 'full' | 'local') => void
  setGatewayAvailable: (available: boolean) => void
  setLocalSessionsAvailable: (available: boolean) => void
  dismissBanner: () => void
  setCapabilitiesChecked: (checked: boolean) => void
  setBootComplete: () => void
  setSubscription: (sub: { type: string; provider?: string; rateLimitTier?: string } | null) => void
  setDefaultOrgName: (name: string) => void

  // Update availability
  updateAvailable: { latestVersion: string; releaseUrl: string; releaseNotes: string } | null
  updateDismissedVersion: string | null
  setUpdateAvailable: (info: { latestVersion: string; releaseUrl: string; releaseNotes: string } | null) => void
  dismissUpdate: (version: string) => void

  // OpenClaw update availability
  openclawUpdate: { installed: string; latest: string; releaseUrl: string; releaseNotes: string; updateCommand: string } | null
  openclawUpdateDismissedVersion: string | null
  setOpenclawUpdate: (info: { installed: string; latest: string; releaseUrl: string; releaseNotes: string; updateCommand: string } | null) => void
  dismissOpenclawUpdate: (version: string) => void

  // OpenClaw Doctor banner dismiss (persisted with 24h expiry)
  doctorDismissedAt: number | null
  dismissDoctor: () => void

  // WebSocket & Connection
  connection: ConnectionStatus
  lastMessage: unknown
  setConnection: (connection: Partial<ConnectionStatus>) => void
  setLastMessage: (message: unknown) => void

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
  memoryFileLinks: { wikiLinks: unknown[]; incoming: string[]; outgoing: string[] } | null
  memoryHealth: unknown | null
  setMemoryFiles: (files: MemoryFile[]) => void
  setSelectedMemoryFile: (path: string | null) => void
  setMemoryContent: (content: string | null) => void
  setMemoryFileLinks: (links: { wikiLinks: unknown[]; incoming: string[]; outgoing: string[] } | null) => void
  setMemoryHealth: (health: unknown | null) => void

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

  // Auth
  currentUser: CurrentUser | null
  setCurrentUser: (user: CurrentUser | null) => void

  // Tenant / Organization context
  activeTenant: Tenant | null
  tenants: Tenant[]
  osUsers: OsUser[]
  setActiveTenant: (tenant: Tenant | null) => void
  setTenants: (tenants: Tenant[]) => void
  fetchTenants: () => Promise<void>
  fetchOsUsers: () => Promise<void>

  // Project context (scoped within current tenant/workspace)
  activeProject: Project | null
  projects: Project[]
  setActiveProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  fetchProjects: () => Promise<void>

  // Project Manager Modal (global)
  showProjectManagerModal: boolean
  setShowProjectManagerModal: (show: boolean) => void

  // Onboarding
  showOnboarding: boolean
  setShowOnboarding: (show: boolean) => void

  // Exec Approvals
  execApprovals: ExecApprovalRequest[]
  setExecApprovals: (approvals: ExecApprovalRequest[]) => void
  addExecApproval: (approval: ExecApprovalRequest) => void
  updateExecApproval: (id: string, updates: Partial<ExecApprovalRequest>) => void

  // Skills (persisted across tab switches)
  skillsList: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] | null
  skillGroups: { source: string; path: string; skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] }[] | null
  skillsTotal: number
  setSkillsData: (skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[], groups: { source: string; path: string; skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] }[], total: number) => void

  // Memory Graph (persisted across tab switches)
  memoryGraphAgents: { name: string; dbSize: number; totalChunks: number; totalFiles: number; files: { path: string; chunks: number; textSize: number }[] }[] | null
  setMemoryGraphAgents: (agents: { name: string; dbSize: number; totalChunks: number; totalFiles: number; files: { path: string; chunks: number; textSize: number }[] }[]) => void

  // Security Posture
  securityPosture?: { score: number; level: string }
  setSecurityPosture: (posture: { score: number; level: string } | undefined) => void

  // Dashboard Layout
  dashboardLayout: string[] | null
  setDashboardLayout: (layout: DashboardLayoutUpdater) => void

  // Interface Mode (essential vs full)
  interfaceMode: 'essential' | 'full'
  setInterfaceMode: (mode: 'essential' | 'full') => void

  // UI State
  activeTab: string
  sidebarExpanded: boolean
  collapsedGroups: string[]
  liveFeedOpen: boolean
  headerDensity: 'focus' | 'compact'
  setActiveTab: (tab: string) => void
  toggleSidebar: () => void
  setSidebarExpanded: (expanded: boolean) => void
  toggleGroup: (groupId: string) => void
  toggleLiveFeed: () => void
  setHeaderDensity: (mode: 'focus' | 'compact') => void
}

export const useMissionControl = create<MissionControlStore>()(
  subscribeWithSelector((set, get) => ({
    // Dashboard Mode
    dashboardMode: 'local' as const,
    gatewayAvailable: false,
    localSessionsAvailable: false,
    bannerDismissed: false,
    capabilitiesChecked: false,
    bootComplete: false,
    subscription: null,
    defaultOrgName: 'Default',
    setDashboardMode: (mode) => set({ dashboardMode: mode }),
    setGatewayAvailable: (available) => set({ gatewayAvailable: available }),
    setLocalSessionsAvailable: (available) => set({ localSessionsAvailable: available }),
    dismissBanner: () => set({ bannerDismissed: true }),
    setCapabilitiesChecked: (checked) => set({ capabilitiesChecked: checked }),
    setBootComplete: () => set({ bootComplete: true }),
    setSubscription: (sub) => set({ subscription: sub }),
    setDefaultOrgName: (name) => set({ defaultOrgName: name }),

    // Onboarding
    showOnboarding: false,
    setShowOnboarding: (show) => set({ showOnboarding: show }),

    // Update availability
    updateAvailable: null,
    updateDismissedVersion: (() => {
      if (typeof window === 'undefined') return null
      try { return localStorage.getItem('mc-update-dismissed-version') } catch { return null }
    })(),
    setUpdateAvailable: (info) => set({ updateAvailable: info }),
    dismissUpdate: (version) => {
      try { localStorage.setItem('mc-update-dismissed-version', version) } catch {}
      set({ updateDismissedVersion: version })
    },

    // OpenClaw update availability
    openclawUpdate: null,
    openclawUpdateDismissedVersion: (() => {
      if (typeof window === 'undefined') return null
      try { return localStorage.getItem('mc-openclaw-update-dismissed') } catch { return null }
    })(),
    setOpenclawUpdate: (info) => set({ openclawUpdate: info }),
    dismissOpenclawUpdate: (version) => {
      try { localStorage.setItem('mc-openclaw-update-dismissed', version) } catch {}
      set({ openclawUpdateDismissedVersion: version })
    },

    // OpenClaw Doctor banner dismiss
    doctorDismissedAt: (() => {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem('mc-doctor-dismissed-at')
        return raw ? Number(raw) : null
      } catch { return null }
    })(),
    dismissDoctor: () => {
      const now = Date.now()
      try { localStorage.setItem('mc-doctor-dismissed-at', String(now)) } catch {}
      set({ doctorDismissedAt: now })
    },

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
        spawnRequests: [request, ...state.spawnRequests].slice(0, 500),
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
    memoryFileLinks: null,
    memoryHealth: null,
    setMemoryFiles: (files) => set({ memoryFiles: files }),
    setSelectedMemoryFile: (path) => set({ selectedMemoryFile: path }),
    setMemoryContent: (content) => set({ memoryContent: content }),
    setMemoryFileLinks: (links) => set({ memoryFileLinks: links }),
    setMemoryHealth: (health) => set({ memoryHealth: health }),

    // Token Usage
    tokenUsage: [],
    addTokenUsage: (usage) =>
      set((state) => ({
        tokenUsage: [...state.tokenUsage, usage].slice(-2000),
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
    availableModels: [...MODEL_CATALOG],
    setAvailableModels: (models) => set({ availableModels: models }),

    // Auth
    currentUser: null,
    setCurrentUser: (user) => set({ currentUser: user }),

    // Tenant / Organization context
    activeTenant: (() => {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem('mc-active-tenant')
        return raw ? JSON.parse(raw) as Tenant : null
      } catch { return null }
    })(),
    tenants: [],
    osUsers: [],
    setActiveTenant: (tenant) => {
      try {
        if (tenant) {
          localStorage.setItem('mc-active-tenant', JSON.stringify(tenant))
        } else {
          localStorage.removeItem('mc-active-tenant')
        }
      } catch {}
      set({ activeTenant: tenant })
    },
    setTenants: (tenants) => set({ tenants }),
    fetchTenants: async () => {
      try {
        const res = await fetch('/api/super/tenants', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const tenantList = Array.isArray(data?.tenants) ? data.tenants : []
        set({ tenants: tenantList })
      } catch {}
    },
    fetchOsUsers: async () => {
      try {
        const res = await fetch('/api/super/os-users', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        set({ osUsers: Array.isArray(data?.users) ? data.users : [] })
      } catch {}
    },

    // Project context
    activeProject: (() => {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem('mc-active-project')
        return raw ? JSON.parse(raw) as Project : null
      } catch { return null }
    })(),
    projects: [],
    setActiveProject: (project) => {
      try {
        if (project) {
          localStorage.setItem('mc-active-project', JSON.stringify(project))
        } else {
          localStorage.removeItem('mc-active-project')
        }
      } catch {}
      set({ activeProject: project })
    },
    setProjects: (projects) => set({ projects }),
    fetchProjects: async () => {
      try {
        const res = await fetch('/api/projects', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const projectList = Array.isArray(data?.projects) ? data.projects : []
        set({ projects: projectList })
      } catch {}
    },

    // Project Manager Modal (global)
    showProjectManagerModal: false,
    setShowProjectManagerModal: (show) => set({ showProjectManagerModal: show }),

    // Exec Approvals
    execApprovals: [],
    setExecApprovals: (approvals) => set({ execApprovals: approvals }),
    addExecApproval: (approval) =>
      set((state) => {
        if (state.execApprovals.some(a => a.id === approval.id)) return state
        return { execApprovals: [approval, ...state.execApprovals].slice(0, 200) }
      }),
    updateExecApproval: (id, updates) =>
      set((state) => ({
        execApprovals: state.execApprovals.map(a => a.id === id ? { ...a, ...updates } : a),
      })),

    // Skills
    skillsList: null,
    skillGroups: null,
    skillsTotal: 0,
    setSkillsData: (skills, groups, total) => set({ skillsList: skills, skillGroups: groups, skillsTotal: total }),

    // Memory Graph
    memoryGraphAgents: null,
    setMemoryGraphAgents: (agents) => set({ memoryGraphAgents: agents }),

    // Security Posture
    securityPosture: undefined,
    setSecurityPosture: (posture) => set({ securityPosture: posture }),

    // Dashboard Layout
    dashboardLayout: (() => {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem('mc-dashboard-layout')
        return raw ? JSON.parse(raw) as string[] : null
      } catch { return null }
    })(),
    setDashboardLayout: (layoutOrUpdater) => {
      const currentLayout = get().dashboardLayout
      const layout = typeof layoutOrUpdater === 'function'
        ? layoutOrUpdater(currentLayout)
        : layoutOrUpdater
      try {
        if (layout) {
          localStorage.setItem('mc-dashboard-layout', JSON.stringify(layout))
        } else {
          localStorage.removeItem('mc-dashboard-layout')
        }
      } catch {}
      set({ dashboardLayout: layout })
    },

    // Interface Mode
    interfaceMode: 'essential' as const,
    setInterfaceMode: (mode) => set({ interfaceMode: mode }),

    // UI State — sidebar & layout persistence
    activeTab: 'overview',
    sidebarExpanded: (() => {
      if (typeof window === 'undefined') return false
      try { return localStorage.getItem('mc-sidebar-expanded') === 'true' } catch { return false }
    })(),
    collapsedGroups: (() => {
      if (typeof window === 'undefined') return [] as string[]
      try {
        const raw = localStorage.getItem('mc-sidebar-groups')
        return raw ? JSON.parse(raw) as string[] : []
      } catch { return [] as string[] }
    })(),
    liveFeedOpen: (() => {
      if (typeof window === 'undefined') return true
      try { return localStorage.getItem('mc-livefeed-open') !== 'false' } catch { return true }
    })(),
    headerDensity: (() => {
      if (typeof window === 'undefined') return 'focus' as const
      try {
        const raw = localStorage.getItem('mc-header-density')
        return raw === 'compact' ? 'compact' : 'focus'
      } catch { return 'focus' as const }
    })(),
    setActiveTab: (tab) => set({ activeTab: tab }),
    toggleSidebar: () =>
      set((state) => {
        const next = !state.sidebarExpanded
        try { localStorage.setItem('mc-sidebar-expanded', String(next)) } catch {}
        return { sidebarExpanded: next }
      }),
    setSidebarExpanded: (expanded) => {
      try { localStorage.setItem('mc-sidebar-expanded', String(expanded)) } catch {}
      set({ sidebarExpanded: expanded })
    },
    toggleGroup: (groupId) =>
      set((state) => {
        const next = state.collapsedGroups.includes(groupId)
          ? state.collapsedGroups.filter(g => g !== groupId)
          : [...state.collapsedGroups, groupId]
        try { localStorage.setItem('mc-sidebar-groups', JSON.stringify(next)) } catch {}
        return { collapsedGroups: next }
      }),
    toggleLiveFeed: () =>
      set((state) => {
        const next = !state.liveFeedOpen
        try { localStorage.setItem('mc-livefeed-open', String(next)) } catch {}
        return { liveFeedOpen: next }
      }),
    setHeaderDensity: (mode) => {
      try { localStorage.setItem('mc-header-density', mode) } catch {}
      set({ headerDensity: mode })
    },

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
        notifications: [notification, ...state.notifications].slice(0, 500),
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
