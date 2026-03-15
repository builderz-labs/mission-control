import type { StateCreator } from 'zustand'
import type { DashboardLayoutUpdater } from '../types'

export interface UISlice {
  dashboardLayout: string[] | null
  setDashboardLayout: (layout: DashboardLayoutUpdater) => void
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

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set, get) => ({
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
})
