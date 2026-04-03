// Persists and restores office panel preferences via localStorage.
// Separated so the load/save logic doesn't clutter the state management shell.

import { useEffect, useMemo } from 'react'
import type { ViewMode, SidebarFilter, TimeTheme, MapRoom, MapProp, PersistedOfficePrefs } from './office-types'
import { clamp } from './office-utils'

interface OfficePrefsState {
  viewMode: ViewMode
  sidebarFilter: SidebarFilter
  localSessionFilter: 'running' | 'not-running'
  mapZoom: number
  mapPan: { x: number; y: number }
  timeTheme: TimeTheme
  showSidebar: boolean
  showMinimap: boolean
  showEvents: boolean
  roomLayoutState: MapRoom[]
  mapPropsState: MapProp[]
}

interface OfficePrefsSetters {
  setViewMode: (v: ViewMode) => void
  setSidebarFilter: (v: SidebarFilter) => void
  setLocalSessionFilter: (v: 'running' | 'not-running') => void
  setMapZoom: (v: number) => void
  setMapPan: (v: { x: number; y: number }) => void
  setTimeTheme: (v: TimeTheme) => void
  setShowSidebar: (v: boolean) => void
  setShowMinimap: (v: boolean) => void
  setShowEvents: (v: boolean) => void
  setRoomLayoutState: (v: MapRoom[]) => void
  setMapPropsState: (v: MapProp[]) => void
}

interface UseOfficePrefsInput {
  currentUserId?: number
  currentUserName?: string
  dashboardMode: string
  state: OfficePrefsState
  setters: OfficePrefsSetters
}

export function useOfficePrefs({
  currentUserId,
  currentUserName,
  dashboardMode,
  state,
  setters,
}: UseOfficePrefsInput): void {
  const officePrefsKey = useMemo(() => {
    const userPart = currentUserId ? `u${currentUserId}` : `guest-${currentUserName || 'anon'}`
    const pathPart = typeof window === 'undefined' ? 'server' : window.location.pathname.replace(/[^a-zA-Z0-9/_-]/g, '_')
    return `mc-office-prefs:v1:${dashboardMode}:${userPart}:${pathPart}`
  }, [currentUserId, currentUserName, dashboardMode])

  // Load preferences on mount (key changes = user/mode switch).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(officePrefsKey)
      if (!raw) return
      const prefs = JSON.parse(raw) as PersistedOfficePrefs
      if (!prefs || prefs.version !== 1) return
      setters.setViewMode(prefs.viewMode || 'office')
      setters.setSidebarFilter(prefs.sidebarFilter || 'all')
      setters.setLocalSessionFilter(prefs.localSessionFilter === 'not-running' ? 'not-running' : 'running')
      setters.setMapZoom(Number.isFinite(prefs.mapZoom) ? clamp(prefs.mapZoom, 0.8, 2.2) : 1)
      setters.setMapPan({ x: Number.isFinite(prefs.mapPan?.x) ? prefs.mapPan.x : 0, y: Number.isFinite(prefs.mapPan?.y) ? prefs.mapPan.y : 0 })
      setters.setTimeTheme(prefs.timeTheme || 'night')
      setters.setShowSidebar(prefs.showSidebar !== false)
      setters.setShowMinimap(prefs.showMinimap !== false)
      setters.setShowEvents(prefs.showEvents !== false)
      if (Array.isArray(prefs.roomLayout) && prefs.roomLayout.length > 0) {
        setters.setRoomLayoutState(prefs.roomLayout.map((room) => ({ ...room })))
      }
      if (Array.isArray(prefs.mapProps) && prefs.mapProps.length > 0) {
        setters.setMapPropsState(prefs.mapProps.map((prop) => ({ ...prop })))
      }
    } catch {
      // ignore corrupted local preferences
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officePrefsKey])

  // Persist preferences whenever any relevant state value changes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload: PersistedOfficePrefs = {
      version: 1,
      viewMode: state.viewMode,
      sidebarFilter: state.sidebarFilter,
      localSessionFilter: state.localSessionFilter,
      mapZoom: state.mapZoom,
      mapPan: state.mapPan,
      timeTheme: state.timeTheme,
      showSidebar: state.showSidebar,
      showMinimap: state.showMinimap,
      showEvents: state.showEvents,
      roomLayout: state.roomLayoutState,
      mapProps: state.mapPropsState,
    }
    try { window.localStorage.setItem(officePrefsKey, JSON.stringify(payload)) } catch { /* ignore storage failures */ }
  }, [
    officePrefsKey,
    state.viewMode, state.sidebarFilter, state.localSessionFilter,
    state.mapZoom, state.mapPan, state.timeTheme,
    state.showSidebar, state.showMinimap, state.showEvents,
    state.roomLayoutState, state.mapPropsState,
  ])
}
