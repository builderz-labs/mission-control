import type { Agent } from '@/store'

export type ViewMode = 'office' | 'org-chart'
export type OrgSegmentMode = 'category' | 'role' | 'status'

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
  path: Array<{ x: number; y: number }>
  pathLengths: number[]
  totalLength: number
  destinationTile: string
}

export type SidebarFilter = 'all' | 'working' | 'idle' | 'attention'

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

export type OfficeAction = 'focus' | 'pair' | 'break'
export type TimeTheme = 'dawn' | 'day' | 'dusk' | 'night'

export type HotspotKind = 'room' | 'desk'

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
  agent: Agent
  x: number
  y: number
  zoneLabel: string
  seatLabel: string
  isMoving: boolean
  direction: { dx: number; dy: number }
  variant: WorkerVariant
}

export interface RosterRow {
  agent: Agent
  minutesIdle: number
  needsAttention: boolean
}

export const statusGlow: Record<string, string> = {
  idle: 'shadow-green-500/40 border-green-500/60',
  busy: 'shadow-yellow-500/40 border-yellow-500/60',
  error: 'shadow-red-500/40 border-red-500/60',
  offline: 'shadow-gray-500/20 border-gray-600/40',
}

export const statusDot: Record<string, string> = {
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
  offline: 'bg-gray-500',
}

export const statusLabel: Record<string, string> = {
  idle: 'Available',
  busy: 'Working',
  error: 'Error',
  offline: 'Away',
}

export const statusEmoji: Record<string, string> = {
  idle: '☕',
  busy: '💻',
  error: '⚠️',
  offline: '💤',
}

export function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
  ]
  return colors[Math.abs(hash) % colors.length]
}

export function hashNumber(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

export function formatLastSeen(ts?: number): string {
  if (!ts) return 'Never seen'
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function easeInOut(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2
}

export function getStatusEmote(status: Agent['status']): string {
  if (status === 'busy') return '💼'
  if (status === 'idle') return '☕'
  if (status === 'error') return '⚠️'
  return '💤'
}

export function inferLocalRole(row: SessionAgentRow): string {
  const context = [
    String(row.agent || ''),
    String(row.key || ''),
    String(row.workingDir || ''),
    String(row.kind || ''),
  ].join(' ').toLowerCase()

  if (/frontend|ui|ux|design|landing|web/.test(context)) return 'frontend-engineer'
  if (/backend|api|server|platform|infra|ops|sre|deploy|k8s|docker/.test(context)) return 'ops-engineer'
  if (/research|science|ml|ai|llm|data|analytics/.test(context)) return 'research-analyst'
  if (/qa|test|e2e|spec|validation/.test(context)) return 'qa-engineer'
  if (/product|pm|roadmap|strategy/.test(context)) return 'product-manager'
  if (/codex|claude|agent/.test(context)) return 'software-engineer'
  return row.kind || 'local-session'
}

export function isInactiveLocalSession(agent: Agent): boolean {
  return Boolean((agent.config as Record<string, unknown> | undefined)?.localSession) && agent.status !== 'busy'
}

export const MAP_COLS = 24
export const MAP_ROWS = 16

export const ROOM_LAYOUT: MapRoom[] = [
  { id: 'eng', label: 'Engineering', x: 16, y: 22, w: 28, h: 22, style: 'bg-[#2a3558]' },
  { id: 'product', label: 'Product', x: 48, y: 22, w: 24, h: 22, style: 'bg-[#213a4d]' },
  { id: 'ops', label: 'Operations', x: 16, y: 49, w: 24, h: 24, style: 'bg-[#2f2f52]' },
  { id: 'research', label: 'Research', x: 44, y: 49, w: 22, h: 24, style: 'bg-[#2b334c]' },
  { id: 'lounge', label: 'Lounge', x: 70, y: 49, w: 16, h: 24, style: 'bg-[#2e4438]' },
]

export const MAP_PROPS: MapProp[] = [
  { id: 'desk-a', x: 22, y: 30, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-b', x: 33, y: 30, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-c', x: 52, y: 30, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-d', x: 61, y: 30, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-e', x: 22, y: 58, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-f', x: 31, y: 58, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-g', x: 48, y: 58, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'desk-h', x: 57, y: 58, w: 8, h: 2.8, style: 'bg-[#33465f]', border: 'border-[#8aa9d8]/60' },
  { id: 'plant-l', x: 14, y: 47, w: 3, h: 5, style: 'bg-emerald-400/60', border: 'border-emerald-200/35' },
  { id: 'plant-r', x: 84, y: 47, w: 3, h: 5, style: 'bg-emerald-400/60', border: 'border-emerald-200/35' },
  { id: 'kitchen', x: 72, y: 57, w: 12, h: 10, style: 'bg-[#334137]', border: 'border-[#88d4a3]/35' },
]

export const LOUNGE_WAYPOINTS = [
  { x: 74, y: 60 },
  { x: 79, y: 60 },
  { x: 82, y: 66 },
  { x: 76, y: 68 },
]

export function getPropSprite(propId: string): string {
  if (propId === 'desk-a' || propId === 'desk-b' || propId === 'desk-e' || propId === 'desk-f') return '/office-sprites/kenney/desk.png'
  if (propId.startsWith('desk-')) return '/office-sprites/kenney/tableCross.png'
  if (propId === 'plant-l') return '/office-sprites/kenney/plantSmall1.png'
  if (propId === 'plant-r') return '/office-sprites/kenney/plantSmall2.png'
  if (propId === 'kitchen') return '/office-sprites/kenney/rugRectangle.png'
  return ''
}

export const HERO_SHEET_COLS = 6
export const HERO_SHEET_ROWS = 7

export function getWorkerHeroFrame(status: Agent['status'], isMoving: boolean, frame: number) {
  const phase = frame % 2
  const walkCol = phase === 0 ? 1 : 3
  if (isMoving) return { col: walkCol, row: 3 }
  if (status === 'busy') return { col: walkCol, row: 0 }
  if (status === 'error') return { col: 5, row: 6 }
  return { col: phase === 0 ? 0 : 5, row: 0 }
}

export const WORKER_VARIANTS: WorkerVariant[] = [
  { id: 'default', filter: 'none', accent: 'border-cyan-300/60' },
  { id: 'warm', filter: 'hue-rotate(18deg) saturate(1.08)', accent: 'border-amber-300/60' },
  { id: 'cool', filter: 'hue-rotate(-20deg) saturate(1.1)', accent: 'border-sky-300/60' },
  { id: 'mint', filter: 'hue-rotate(42deg) saturate(1.08)', accent: 'border-emerald-300/60' },
  { id: 'violet', filter: 'hue-rotate(64deg) saturate(1.12)', accent: 'border-violet-300/60' },
]

export function getWorkerVariant(name: string): WorkerVariant {
  return WORKER_VARIANTS[hashNumber(name) % WORKER_VARIANTS.length]
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function toTile(xPercent: number, yPercent: number) {
  const col = clamp(Math.round((xPercent / 100) * (MAP_COLS - 1)), 0, MAP_COLS - 1)
  const row = clamp(Math.round((yPercent / 100) * (MAP_ROWS - 1)), 0, MAP_ROWS - 1)
  return { col, row }
}

export function tileToPercent(col: number, row: number) {
  const x = (col / (MAP_COLS - 1)) * 100
  const y = (row / (MAP_ROWS - 1)) * 100
  return { x, y }
}

export function buildWalkabilityGrid() {
  const walkable: boolean[][] = Array.from({ length: MAP_ROWS }, () => Array.from({ length: MAP_COLS }, () => true))
  for (let r = 0; r < MAP_ROWS; r += 1) {
    walkable[r][0] = false
    walkable[r][MAP_COLS - 1] = false
  }
  for (let c = 0; c < MAP_COLS; c += 1) {
    walkable[0][c] = false
    walkable[MAP_ROWS - 1][c] = false
  }

  const obstacleRects = [
    { c1: 5, c2: 8, r1: 4, r2: 5 },
    { c1: 9, c2: 12, r1: 4, r2: 5 },
    { c1: 13, c2: 16, r1: 4, r2: 5 },
    { c1: 17, c2: 20, r1: 4, r2: 5 },
    { c1: 5, c2: 8, r1: 9, r2: 10 },
    { c1: 9, c2: 12, r1: 9, r2: 10 },
    { c1: 13, c2: 16, r1: 9, r2: 10 },
    { c1: 17, c2: 20, r1: 9, r2: 10 },
    { c1: 18, c2: 21, r1: 10, r2: 13 },
  ]
  for (const rect of obstacleRects) {
    for (let r = rect.r1; r <= rect.r2; r += 1) {
      for (let c = rect.c1; c <= rect.c2; c += 1) {
        if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) walkable[r][c] = false
      }
    }
  }

  const corridorRow = 7
  for (let c = 1; c < MAP_COLS - 1; c += 1) walkable[corridorRow][c] = true
  return walkable
}

export function tileKey(col: number, row: number): string {
  return `${col},${row}`
}

export function findGridPath(start: { col: number; row: number }, end: { col: number; row: number }, walkable: boolean[][]) {
  const inBounds = (col: number, row: number) => row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS
  const key = (col: number, row: number) => `${col},${row}`
  const parse = (k: string) => {
    const [c, r] = k.split(',').map(Number)
    return { col: c, row: r }
  }

  const open = new Set<string>([key(start.col, start.row)])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[key(start.col, start.row), 0]])
  const fScore = new Map<string, number>([[key(start.col, start.row), Math.abs(start.col - end.col) + Math.abs(start.row - end.row)]])

  while (open.size > 0) {
    let currentKey = ''
    let lowest = Number.POSITIVE_INFINITY
    for (const k of open) {
      const f = fScore.get(k) ?? Number.POSITIVE_INFINITY
      if (f < lowest) {
        lowest = f
        currentKey = k
      }
    }
    if (!currentKey) break

    const current = parse(currentKey)
    if (current.col === end.col && current.row === end.row) {
      const path = [current]
      let ck = currentKey
      while (cameFrom.has(ck)) {
        ck = cameFrom.get(ck)!
        path.push(parse(ck))
      }
      path.reverse()
      return path
    }

    open.delete(currentKey)
    const neighbors = [
      { col: current.col + 1, row: current.row },
      { col: current.col - 1, row: current.row },
      { col: current.col, row: current.row + 1 },
      { col: current.col, row: current.row - 1 },
    ]

    for (const n of neighbors) {
      if (!inBounds(n.col, n.row)) continue
      if (!walkable[n.row][n.col]) continue
      const nk = key(n.col, n.row)
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1
      if (tentative >= (gScore.get(nk) ?? Number.POSITIVE_INFINITY)) continue
      cameFrom.set(nk, currentKey)
      gScore.set(nk, tentative)
      fScore.set(nk, tentative + Math.abs(n.col - end.col) + Math.abs(n.row - end.row))
      open.add(nk)
    }
  }

  return [start, end]
}

export function buildPath(startX: number, startY: number, endX: number, endY: number, blockedTiles: Set<string> = new Set()) {
  const walkable = buildWalkabilityGrid()
  const startTile = toTile(startX, startY)
  const endTile = toTile(endX, endY)
  for (const tile of blockedTiles) {
    const [col, row] = tile.split(',').map(Number)
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) continue
    walkable[row][col] = false
  }
  walkable[startTile.row][startTile.col] = true
  walkable[endTile.row][endTile.col] = true
  const tilePath = findGridPath(startTile, endTile, walkable)
  const path = tilePath.map((tile) => tileToPercent(tile.col, tile.row))
  const pathLengths: number[] = [0]
  let totalLength = 0
  for (let i = 1; i < path.length; i += 1) {
    const dx = path[i].x - path[i - 1].x
    const dy = path[i].y - path[i - 1].y
    totalLength += Math.hypot(dx, dy)
    pathLengths.push(totalLength)
  }
  return { path, pathLengths, totalLength }
}

export function pointAlongPath(path: Array<{ x: number; y: number }>, pathLengths: number[], totalLength: number, progress: number) {
  if (path.length === 0) return { x: 0, y: 0 }
  if (path.length === 1 || totalLength <= 0) return path[path.length - 1]
  const target = totalLength * clamp(progress, 0, 1)
  let idx = 1
  while (idx < pathLengths.length && pathLengths[idx] < target) idx += 1
  const prevIdx = Math.max(0, idx - 1)
  const prevLen = pathLengths[prevIdx] ?? 0
  const nextLen = pathLengths[Math.min(idx, pathLengths.length - 1)] ?? totalLength
  const local = nextLen > prevLen ? (target - prevLen) / (nextLen - prevLen) : 0
  const a = path[prevIdx]
  const b = path[Math.min(idx, path.length - 1)]
  return {
    x: a.x + (b.x - a.x) * local,
    y: a.y + (b.y - a.y) * local,
  }
}
