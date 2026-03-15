import type { StateCreator } from 'zustand'
import { MODEL_CATALOG } from '@/lib/models'
import type {
  Session,
  LogEntry,
  CronJob,
  SpawnRequest,
  MemoryFile,
  TokenUsage,
  ModelConfig,
  StandupReport,
  CurrentUser,
  Tenant,
  OsUser,
  Project,
  ConnectionStatus,
  ExecApprovalRequest,
} from '../types'

export interface SessionSlice {
  // Dashboard Mode (local vs full gateway)
  dashboardMode: 'full' | 'local'
  gatewayAvailable: boolean
  bannerDismissed: boolean
  capabilitiesChecked: boolean
  bootComplete: boolean
  subscription: { type: string; provider?: string; rateLimitTier?: string } | null
  defaultOrgName: string
  setDashboardMode: (mode: 'full' | 'local') => void
  setGatewayAvailable: (available: boolean) => void
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

  // OpenClaw Doctor banner dismiss
  doctorDismissedAt: number | null
  dismissDoctor: () => void

  // WebSocket & Connection
  connection: ConnectionStatus
  lastMessage: unknown
  setConnection: (connection: Partial<ConnectionStatus>) => void
  setLastMessage: (message: unknown) => void

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

  // Project context
  activeProject: Project | null
  projects: Project[]
  setActiveProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  fetchProjects: () => Promise<void>

  // Project Manager Modal
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

  // Skills
  skillsList: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] | null
  skillGroups: { source: string; path: string; skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] }[] | null
  skillsTotal: number
  setSkillsData: (skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[], groups: { source: string; path: string; skills: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] }[], total: number) => void

  // Memory Graph
  memoryGraphAgents: { name: string; dbSize: number; totalChunks: number; totalFiles: number; files: { path: string; chunks: number; textSize: number }[] }[] | null
  setMemoryGraphAgents: (agents: { name: string; dbSize: number; totalChunks: number; totalFiles: number; files: { path: string; chunks: number; textSize: number }[] }[]) => void

  // Security Posture
  securityPosture?: { score: number; level: string }
  setSecurityPosture: (posture: { score: number; level: string } | undefined) => void

  // Interface Mode
  interfaceMode: 'essential' | 'full'
  setInterfaceMode: (mode: 'essential' | 'full') => void

  // Standup
  standupReports: StandupReport[]
  currentStandupReport: StandupReport | null
  setStandupReports: (reports: StandupReport[]) => void
  setCurrentStandupReport: (report: StandupReport | null) => void
}

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set, get) => ({
  // Dashboard Mode
  dashboardMode: 'local' as const,
  gatewayAvailable: false,
  bannerDismissed: false,
  capabilitiesChecked: false,
  bootComplete: false,
  subscription: null,
  defaultOrgName: 'Default',
  setDashboardMode: (mode) => set({ dashboardMode: mode }),
  setGatewayAvailable: (available) => set({ gatewayAvailable: available }),
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
      const existingLogIndex = state.logs.findIndex(existingLog => existingLog.id === log.id)
      if (existingLogIndex !== -1) {
        const updatedLogs = [...state.logs]
        updatedLogs[existingLogIndex] = log
        return { logs: updatedLogs }
      }
      return {
        logs: [log, ...state.logs].slice(0, 1000),
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

  // Project Manager Modal
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

  // Interface Mode
  interfaceMode: 'essential' as const,
  setInterfaceMode: (mode) => set({ interfaceMode: mode }),

  // Standup
  standupReports: [],
  currentStandupReport: null,
  setStandupReports: (reports) => set({ standupReports: reports }),
  setCurrentStandupReport: (report) => set({ currentStandupReport: report }),
})
