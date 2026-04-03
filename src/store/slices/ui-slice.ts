'use client'

import type { StateCreator } from 'zustand'
import type { ConnectionStatus } from '../shared-types'

export type { ConnectionStatus }

type DashboardLayoutUpdater = string[] | null | ((current: string[] | null) => string[] | null)

export interface UiSlice {
  // Dashboard mode (local vs full gateway)
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

  // App update notifications
  updateAvailable: { latestVersion: string; releaseUrl: string; releaseNotes: string } | null
  updateDismissedVersion: string | null
  setUpdateAvailable: (info: { latestVersion: string; releaseUrl: string; releaseNotes: string } | null) => void
  dismissUpdate: (version: string) => void

  // OpenClaw update notifications
  openclawUpdate: { installed: string; latest: string; releaseUrl: string; releaseNotes: string; updateCommand: string } | null
  openclawUpdateDismissedVersion: string | null
  setOpenclawUpdate: (info: { installed: string; latest: string; releaseUrl: string; releaseNotes: string; updateCommand: string } | null) => void
  dismissOpenclawUpdate: (version: string) => void

  // Connection state
  connection: ConnectionStatus
  lastMessage: unknown
  setConnection: (connection: Partial<ConnectionStatus>) => void
  setLastMessage: (message: unknown) => void

  // Skills panel cache (persisted across tab switches to avoid refetch)
  skillsList: {
    id: string; name: string; source: string; path: string; description?: string
    registry_slug?: string | null; security_status?: string | null
  }[] | null
  skillGroups: {
    source: string; path: string; skills: {
      id: string; name: string; source: string; path: string; description?: string
      registry_slug?: string | null; security_status?: string | null
    }[]
  }[] | null
  skillsTotal: number
  setSkillsData: (
    skills: {
      id: string; name: string; source: string; path: string; description?: string
      registry_slug?: string | null; security_status?: string | null
    }[],
    groups: {
      source: string; path: string; skills: {
        id: string; name: string; source: string; path: string; description?: string
        registry_slug?: string | null; security_status?: string | null
      }[]
    }[],
    total: number
  ) => void

  // Memory graph (persisted across tab switches)
  memoryGraphAgents: {
    name: string; dbSize: number; totalChunks: number; totalFiles: number
    files: { path: string; chunks: number; textSize: number }[]
  }[] | null
  setMemoryGraphAgents: (agents: {
    name: string; dbSize: number; totalChunks: number; totalFiles: number
    files: { path: string; chunks: number; textSize: number }[]
  }[]) => void

  // Security posture score
  securityPosture?: { score: number; level: string }
  setSecurityPosture: (posture: { score: number; level: string } | undefined) => void

  // Dashboard panel layout (persisted to localStorage)
  dashboardLayout: string[] | null
  setDashboardLayout: (layout: DashboardLayoutUpdater) => void

  // Interface density mode
  interfaceMode: 'essential' | 'full'
  setInterfaceMode: (mode: 'essential' | 'full') => void

  // Sidebar & navigation state (persisted to localStorage)
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

  // Onboarding flow
  showOnboarding: boolean
  setShowOnboarding: (show: boolean) => void

  // Project manager modal (global singleton)
  showProjectManagerModal: boolean
  setShowProjectManagerModal: (show: boolean) => void
}

// Reads a localStorage key safely, returning null on SSR or parse failure
function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}

// UI slice — layout, sidebar, banners, connection status, update notifications
export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set, get) => ({
  dashboardMode: 'local',
  gatewayAvailable: false,
  bannerDismissed: false,
  capabilitiesChecked: false,
  bootComplete: false,
  subscription: null,
  defaultOrgName: 'Default',
  updateAvailable: null,
  openclawUpdate: null,
  lastMessage: null,
  skillsList: null,
  skillGroups: null,
  skillsTotal: 0,
  memoryGraphAgents: null,
  securityPosture: undefined,
  interfaceMode: 'essential',
  activeTab: 'overview',
  showOnboarding: false,
  showProjectManagerModal: false,

  // Lazy-read persisted values from localStorage on first access
  updateDismissedVersion: readLocalStorage('mc-update-dismissed-version'),

  openclawUpdateDismissedVersion: readLocalStorage('mc-openclaw-update-dismissed'),

  connection: { isConnected: false, url: '', reconnectAttempts: 0 },

  dashboardLayout: (() => {
    const raw = readLocalStorage('mc-dashboard-layout')
    try { return raw ? JSON.parse(raw) as string[] : null } catch { return null }
  })(),

  sidebarExpanded: readLocalStorage('mc-sidebar-expanded') === 'true',

  collapsedGroups: (() => {
    const raw = readLocalStorage('mc-sidebar-groups')
    try { return raw ? JSON.parse(raw) as string[] : [] } catch { return [] }
  })(),

  liveFeedOpen: readLocalStorage('mc-livefeed-open') !== 'false',

  headerDensity: (() => {
    const raw = readLocalStorage('mc-header-density')
    return raw === 'compact' ? 'compact' : 'focus'
  })(),

  setDashboardMode: (mode) => set({ dashboardMode: mode }),
  setGatewayAvailable: (available) => set({ gatewayAvailable: available }),
  dismissBanner: () => set({ bannerDismissed: true }),
  setCapabilitiesChecked: (checked) => set({ capabilitiesChecked: checked }),
  setBootComplete: () => set({ bootComplete: true }),
  setSubscription: (sub) => set({ subscription: sub }),
  setDefaultOrgName: (name) => set({ defaultOrgName: name }),

  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  dismissUpdate: (version) => {
    try { localStorage.setItem('mc-update-dismissed-version', version) } catch {}
    set({ updateDismissedVersion: version })
  },

  setOpenclawUpdate: (info) => set({ openclawUpdate: info }),
  dismissOpenclawUpdate: (version) => {
    try { localStorage.setItem('mc-openclaw-update-dismissed', version) } catch {}
    set({ openclawUpdateDismissedVersion: version })
  },

  setConnection: (connection) =>
    set((state) => ({ connection: { ...state.connection, ...connection } })),
  setLastMessage: (message) => set({ lastMessage: message }),

  setSkillsData: (skills, groups, total) =>
    set({ skillsList: skills, skillGroups: groups, skillsTotal: total }),

  setMemoryGraphAgents: (agents) => set({ memoryGraphAgents: agents }),

  setSecurityPosture: (posture) => set({ securityPosture: posture }),

  setDashboardLayout: (layoutOrUpdater) => {
    const currentLayout = get().dashboardLayout
    const layout =
      typeof layoutOrUpdater === 'function'
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

  setInterfaceMode: (mode) => set({ interfaceMode: mode }),

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
        ? state.collapsedGroups.filter((g) => g !== groupId)
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

  setShowOnboarding: (show) => set({ showOnboarding: show }),

  setShowProjectManagerModal: (show) => set({ showProjectManagerModal: show }),
})
