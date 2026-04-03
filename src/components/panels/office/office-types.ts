// Shared types for the office panel sub-components.
// All types are readonly to enforce immutability across the panel.

export type ViewMode = 'office' | 'org-chart'
export type OrgSegmentMode = 'category' | 'role' | 'status'
export type SidebarFilter = 'all' | 'working' | 'idle' | 'attention'
export type OfficeAction = 'focus' | 'pair' | 'break'
export type TimeTheme = 'dawn' | 'day' | 'dusk' | 'night'
export type HotspotKind = 'room' | 'desk'

export interface SessionAgentRow {
  id: string
  key: string
  agent: string
  kind: string
  model: string
  active: boolean
  lastActivity?: number
  workingDir?: string | null
}

export interface SeatPosition {
  seatKey: string
  x: number
  y: number
}

export interface MovingWorker {
  id: string
  agentId: number
  initials: string
  colorClass: string
  startX: number
  startY: number
  endX: number
  endY: number
  startedAt: number
  durationMs: number
  progress: number
  path: ReadonlyArray<{ x: number; y: number }>
  pathLengths: number[]
  totalLength: number
  destinationTile: string
}

export interface MapRoom {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  style: string
}

export interface MapProp {
  id: string
  x: number
  y: number
  w: number
  h: number
  style: string
  border: string
}

export interface LaunchToast {
  kind: 'success' | 'info' | 'error'
  title: string
  detail: string
}

export interface OfficeHotspot {
  kind: HotspotKind
  id: string
  label: string
  x: number
  y: number
  stats: string[]
}

export interface OfficeEvent {
  id: string
  kind: 'action' | 'room' | 'desk'
  message: string
  at: number
  severity: 'info' | 'warn' | 'good'
}

export interface ThemePalette {
  shell: string
  gridLine: string
  haze: string
  glow: string
  corridor: string
  corridorStripe: string
  atmosphere: string
  shadowVeil: string
  floorFilter: string
  spriteFilter: string
  roomTone: string
  floorOpacityA: number
  floorOpacityB: number
  accentGlow: string
}

export interface PersistedOfficePrefs {
  version: 1
  viewMode: ViewMode
  sidebarFilter: SidebarFilter
  localSessionFilter?: 'running' | 'not-running'
  mapZoom: number
  mapPan: { x: number; y: number }
  timeTheme: TimeTheme
  showSidebar: boolean
  showMinimap: boolean
  showEvents: boolean
  roomLayout: MapRoom[]
  mapProps: MapProp[]
}

export interface WorkerVariant {
  id: string
  filter: string
  accent: string
}

export interface RenderedWorker {
  agent: import('@/store').Agent
  x: number
  y: number
  zoneLabel: string
  seatLabel: string
  isMoving: boolean
  direction: { dx: number; dy: number }
  variant: WorkerVariant
}

// ─── Shell-local types (also used by derived hooks) ───────────────────────────

export interface FloorTile {
  id: string
  x: number
  y: number
  w: number
  h: number
  sprite: boolean
}

export interface HeatmapPoint {
  id: number
  x: number
  y: number
  radius: number
  color: string
}

export interface PathEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface NightSparkle {
  id: number
  x: number
  y: number
  delay: number
  size: number
}

export interface RosterRow {
  agent: import('@/store').Agent
  minutesIdle: number
  needsAttention: boolean
}
