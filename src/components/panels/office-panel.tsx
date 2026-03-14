'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { MouseEvent, WheelEvent } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl, Agent } from '@/store'
import { buildOfficeLayout } from '@/lib/office-layout'

type ViewMode = 'office' | 'org-chart'
type OrgSegmentMode = 'category' | 'role' | 'status'

interface SessionAgentRow {
  id: string
  key: string
  agent: string
  kind: string
  model: string
  active: boolean
  lastActivity?: number
  workingDir?: string | null
}

interface SeatPosition {
  seatKey: string
  x: number
  y: number
}

interface MovingWorker {
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

type SidebarFilter = 'all' | 'working' | 'idle' | 'attention'

interface MapRoom {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  style: string
}

interface MapProp {
  id: string
  x: number
  y: number
  w: number
  h: number
  style: string
  border: string
}

interface LaunchToast {
  kind: 'success' | 'info' | 'error'
  title: string
  detail: string
}

type OfficeAction = 'focus' | 'pair' | 'break'
type TimeTheme = 'dawn' | 'day' | 'dusk' | 'night'

type HotspotKind = 'room' | 'desk'

interface OfficeHotspot {
  kind: HotspotKind
  id: string
  label: string
  x: number
  y: number
  stats: string[]
}

interface OfficeEvent {
  id: string
  kind: 'action' | 'room' | 'desk'
  message: string
  at: number
  severity: 'info' | 'warn' | 'good'
}

interface ThemePalette {
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

interface PersistedOfficePrefs {
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

const statusGlow: Record<string, string> = {
  idle: 'shadow-[0_0_12px_hsl(var(--void-mint)/0.3)] border-void-mint/60',
  busy: 'shadow-[0_0_12px_hsl(var(--void-amber)/0.3)] border-void-amber/60',
  error: 'shadow-[0_0_12px_hsl(var(--void-crimson)/0.3)] border-void-crimson/60',
  offline: 'shadow-[0_0_8px_hsl(var(--border)/0.2)] border-border/40',
}

const statusDot: Record<string, string> = {
  idle: 'bg-void-mint',
  busy: 'bg-void-amber',
  error: 'bg-void-crimson',
  offline: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  idle: 'Standby',
  busy: 'Active',
  error: 'Alert',
  offline: 'Offline',
}

const statusEmoji: Record<string, string> = {
  idle: '',
  busy: '',
  error: '',
  offline: '',
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
  ]
  return colors[Math.abs(hash) % colors.length]
}

function hashNumber(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

function formatLastSeen(ts?: number, t?: (key: string, values?: Record<string, unknown>) => string): string {
  if (!ts) return t ? t('neverSeen') : 'Never seen'
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return t ? t('justNow') : 'Just now'
  if (m < 60) return t ? t('minutesAgo', { minutes: m }) : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return t ? t('hoursAgo', { hours: h }) : `${h}h ago`
  return t ? t('daysAgo', { days: Math.floor(h / 24) }) : `${Math.floor(h / 24)}d ago`
}

function easeInOut(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2
}

function getStatusEmote(status: Agent['status']): string {
  if (status === 'busy') return '\u25CF'  // filled circle
  if (status === 'idle') return '\u25CB'  // open circle
  if (status === 'error') return '\u25B2'  // triangle
  return '\u2013'  // dash
}

function inferLocalRole(row: SessionAgentRow): string {
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

function isInactiveLocalSession(agent: Agent): boolean {
  return Boolean((agent.config as any)?.localSession) && agent.status !== 'busy'
}

const MAP_COLS = 24
const MAP_ROWS = 16

const ROOM_LAYOUT: MapRoom[] = [
  { id: 'eng', label: 'Engine Bay', x: 16, y: 22, w: 28, h: 22, style: 'bg-[#0c1628]' },
  { id: 'product', label: 'Bridge', x: 48, y: 22, w: 24, h: 22, style: 'bg-[#0a1a2a]' },
  { id: 'ops', label: 'Ops Deck', x: 16, y: 49, w: 24, h: 24, style: 'bg-[#10132a]' },
  { id: 'research', label: 'Lab', x: 44, y: 49, w: 22, h: 24, style: 'bg-[#0d1526]' },
  { id: 'lounge', label: 'Crew Quarters', x: 70, y: 49, w: 16, h: 24, style: 'bg-[#0c1a1a]' },
]

const MAP_PROPS: MapProp[] = [
  { id: 'desk-a', x: 22, y: 30, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-b', x: 33, y: 30, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-c', x: 52, y: 30, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-d', x: 61, y: 30, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-e', x: 22, y: 58, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-f', x: 31, y: 58, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-g', x: 48, y: 58, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-h', x: 57, y: 58, w: 8, h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'plant-l', x: 14, y: 47, w: 3, h: 5, style: 'bg-void-mint/30', border: 'border-void-mint/20' },
  { id: 'plant-r', x: 84, y: 47, w: 3, h: 5, style: 'bg-void-mint/30', border: 'border-void-mint/20' },
  { id: 'kitchen', x: 72, y: 57, w: 12, h: 10, style: 'bg-[#0c1a1a]', border: 'border-void-mint/20' },
]

const LOUNGE_WAYPOINTS = [
  { x: 74, y: 60 },
  { x: 79, y: 60 },
  { x: 82, y: 66 },
  { x: 76, y: 68 },
]

function getPropSprite(propId: string): string {
  if (propId === 'desk-a' || propId === 'desk-b' || propId === 'desk-e' || propId === 'desk-f') return '/office-sprites/kenney/desk.png'
  if (propId.startsWith('desk-')) return '/office-sprites/kenney/tableCross.png'
  if (propId === 'plant-l') return '/office-sprites/kenney/plantSmall1.png'
  if (propId === 'plant-r') return '/office-sprites/kenney/plantSmall2.png'
  if (propId === 'kitchen') return '/office-sprites/kenney/rugRectangle.png'
  return ''
}

const HERO_SHEET_COLS = 6
const HERO_SHEET_ROWS = 7

function getWorkerHeroFrame(status: Agent['status'], isMoving: boolean, frame: number) {
  const phase = frame % 2
  const walkCol = phase === 0 ? 1 : 3
  if (isMoving) return { col: walkCol, row: 3 } // side-walk row
  if (status === 'busy') return { col: walkCol, row: 0 } // forward loop as typing proxy
  if (status === 'error') return { col: 5, row: 6 }
  return { col: phase === 0 ? 0 : 5, row: 0 } // idle pulse
}

interface WorkerVariant {
  id: string
  filter: string
  accent: string
}

const WORKER_VARIANTS: WorkerVariant[] = [
  { id: 'default', filter: 'none', accent: 'border-cyan-300/60' },
  { id: 'warm', filter: 'hue-rotate(18deg) saturate(1.08)', accent: 'border-amber-300/60' },
  { id: 'cool', filter: 'hue-rotate(-20deg) saturate(1.1)', accent: 'border-sky-300/60' },
  { id: 'mint', filter: 'hue-rotate(42deg) saturate(1.08)', accent: 'border-emerald-300/60' },
  { id: 'violet', filter: 'hue-rotate(64deg) saturate(1.12)', accent: 'border-violet-300/60' },
]

function getWorkerVariant(name: string): WorkerVariant {
  return WORKER_VARIANTS[hashNumber(name) % WORKER_VARIANTS.length]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toTile(xPercent: number, yPercent: number) {
  const col = clamp(Math.round((xPercent / 100) * (MAP_COLS - 1)), 0, MAP_COLS - 1)
  const row = clamp(Math.round((yPercent / 100) * (MAP_ROWS - 1)), 0, MAP_ROWS - 1)
  return { col, row }
}

function tileToPercent(col: number, row: number) {
  const x = (col / (MAP_COLS - 1)) * 100
  const y = (row / (MAP_ROWS - 1)) * 100
  return { x, y }
}

function buildWalkabilityGrid() {
  const walkable: boolean[][] = Array.from({ length: MAP_ROWS }, () => Array.from({ length: MAP_COLS }, () => true))
  // Border walls
  for (let r = 0; r < MAP_ROWS; r += 1) {
    walkable[r][0] = false
    walkable[r][MAP_COLS - 1] = false
  }
  for (let c = 0; c < MAP_COLS; c += 1) {
    walkable[0][c] = false
    walkable[MAP_ROWS - 1][c] = false
  }

  // Block static furniture/obstacles so routes prefer corridor lanes.
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

  // Keep a central horizontal corridor open.
  const corridorRow = 7
  for (let c = 1; c < MAP_COLS - 1; c += 1) walkable[corridorRow][c] = true
  return walkable
}

function tileKey(col: number, row: number): string {
  return `${col},${row}`
}

function findGridPath(start: { col: number; row: number }, end: { col: number; row: number }, walkable: boolean[][]) {
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

function buildPath(startX: number, startY: number, endX: number, endY: number, blockedTiles: Set<string> = new Set()) {
  const walkable = buildWalkabilityGrid()
  const startTile = toTile(startX, startY)
  const endTile = toTile(endX, endY)
  for (const tile of blockedTiles) {
    const [col, row] = tile.split(',').map(Number)
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) continue
    walkable[row][col] = false
  }
  // Start/end must always be traversable.
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

function pointAlongPath(path: Array<{ x: number; y: number }>, pathLengths: number[], totalLength: number, progress: number) {
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

export function OfficePanel() {
  const t = useTranslations('office')
  const { agents, dashboardMode, currentUser } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [localAgents, setLocalAgents] = useState<Agent[]>([])
  const [sessionAgents, setSessionAgents] = useState<Agent[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('office')
  const [orgSegmentMode, setOrgSegmentMode] = useState<OrgSegmentMode>('category')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showFlightDeckModal, setShowFlightDeckModal] = useState(false)
  const [flightDeckDownloadUrl, setFlightDeckDownloadUrl] = useState('https://flightdeck.example.com/download')
  const [flightDeckLaunching, setFlightDeckLaunching] = useState(false)
  const [launchToast, setLaunchToast] = useState<LaunchToast | null>(null)
  const [selectedHotspot, setSelectedHotspot] = useState<OfficeHotspot | null>(null)
  const [agentActionOverrides, setAgentActionOverrides] = useState<Map<number, OfficeAction>>(new Map())
  const [officeEvents, setOfficeEvents] = useState<OfficeEvent[]>([])
  const [roomLayoutState, setRoomLayoutState] = useState<MapRoom[]>(() => ROOM_LAYOUT.map((room) => ({ ...room })))
  const [mapPropsState, setMapPropsState] = useState<MapProp[]>(() => MAP_PROPS.map((prop) => ({ ...prop })))
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [localSessionFilter, setLocalSessionFilter] = useState<'running' | 'not-running'>('running')
  const [loading, setLoading] = useState(true)
  const [localBootstrapping, setLocalBootstrapping] = useState(isLocalMode)
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all')
  const [spriteFrame, setSpriteFrame] = useState(0)
  const [timeTheme, setTimeTheme] = useState<TimeTheme>('night')
  const [mapZoom, setMapZoom] = useState(1)
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 })
  const mapViewportRef = useRef<HTMLDivElement | null>(null)
  const localBootstrapRetries = useRef(0)
  const mapDragActiveRef = useRef(false)
  const mapDragOriginRef = useRef({ x: 0, y: 0 })
  const mapPanStartRef = useRef({ x: 0, y: 0 })
  const prevStatusRef = useRef<Map<number, Agent['status']>>(new Map())
  const transitionTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const launchToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const roamReturnTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const movingAgentIdsRef = useRef<Set<number>>(new Set())
  const movingWorkersRef = useRef<MovingWorker[]>([])
  const renderedWorkersRef = useRef<Array<{ agent: Agent; x: number; y: number; zoneLabel: string; seatLabel: string; isMoving: boolean; direction: { dx: number; dy: number }; variant: WorkerVariant }>>([])
  const [transitioningAgentIds, setTransitioningAgentIds] = useState<Set<number>>(new Set())
  const previousSeatMapRef = useRef<Map<number, SeatPosition>>(new Map())
  const [movingWorkers, setMovingWorkers] = useState<MovingWorker[]>([])

  const fetchAgents = useCallback(async () => {
    let nextLocalAgents: Agent[] = []
    let nextSessionAgents: Agent[] = []

    try {
      const [agentRes, sessionRes] = await Promise.all([
        fetch('/api/agents'),
        isLocalMode ? fetch('/api/sessions') : Promise.resolve(null),
      ])

      if (agentRes.ok) {
        const data = await agentRes.json()
        nextLocalAgents = Array.isArray(data.agents) ? data.agents : []
        setLocalAgents(nextLocalAgents)
      }

      if (isLocalMode && sessionRes?.ok) {
        const sessionJson = await sessionRes.json().catch(() => ({}))
        const rows = Array.isArray(sessionJson?.sessions) ? sessionJson.sessions as SessionAgentRow[] : []
        const byAgent = new Map<string, Agent>()
        let idx = 0

        for (const row of rows) {
          const name = String(row.agent || '').trim()
          if (!name) continue
          const existing = byAgent.get(name)
          const nowSec = Math.floor(Date.now() / 1000)
          const lastSeenSec = row.lastActivity ? Math.floor(row.lastActivity / 1000) : nowSec
          const inferredRole = inferLocalRole(row)
          const candidate: Agent = {
            id: -5000 - idx,
            name,
            role: inferredRole,
            status: row.active ? 'busy' : 'idle',
            last_seen: lastSeenSec,
            last_activity: `${row.kind || 'session'} · ${row.model || 'unknown model'}`,
            session_key: row.key || row.id,
            created_at: nowSec,
            updated_at: nowSec,
            config: {
              localSession: {
                sessionId: row.id,
                key: row.key,
                workingDir: row.workingDir || null,
                kind: row.kind || 'session',
              },
            },
          }

          const existingLastSeen = existing?.last_seen || 0
          const candidateLastSeen = candidate.last_seen || 0
          const shouldReplace =
            !existing ||
            (existing.status !== 'busy' && candidate.status === 'busy') ||
            (existing.status === candidate.status && candidateLastSeen > existingLastSeen)

          if (shouldReplace) {
            byAgent.set(name, candidate)
            idx += 1
          }
        }

        nextSessionAgents = Array.from(byAgent.values())
        setSessionAgents(nextSessionAgents)
      }
    } catch { /* ignore */ }

    if (isLocalMode) {
      const hasAnyAgents = nextLocalAgents.length > 0 || nextSessionAgents.length > 0
      if (hasAnyAgents) setLocalBootstrapping(false)
      if (!hasAnyAgents && localBootstrapRetries.current < 5) {
        localBootstrapRetries.current += 1
        setLoading(true)
        setTimeout(() => {
          void fetchAgents()
        }, 700)
        return
      }
    }

    setLoading(false)
  }, [isLocalMode])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  useEffect(() => {
    if (!isLocalMode) {
      setLocalBootstrapping(false)
      return
    }
    setLocalBootstrapping(true)
    const bootstrapTimer = setTimeout(() => {
      setLocalBootstrapping(false)
    }, 4500)
    return () => clearTimeout(bootstrapTimer)
  }, [isLocalMode])

  useEffect(() => {
    const interval = setInterval(fetchAgents, 10000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  useEffect(() => {
    const interval = setInterval(() => {
      setSpriteFrame((current) => (current + 1) % 2)
    }, 380)
    return () => clearInterval(interval)
  }, [])

  const displayAgents = useMemo(() => {
    if (agents.length > 0) return agents
    if (isLocalMode) {
      const merged = new Map<string, Agent>()
      for (const agent of [...sessionAgents, ...localAgents]) {
        const key = String(agent.name || '').trim().toLowerCase()
        if (!key) continue
        const existing = merged.get(key)
        if (!existing) {
          merged.set(key, agent)
          continue
        }
        const existingLastSeen = existing.last_seen || 0
        const candidateLastSeen = agent.last_seen || 0
        const shouldReplace =
          (existing.status !== 'busy' && agent.status === 'busy') ||
          (existing.status === agent.status && candidateLastSeen > existingLastSeen)
        if (shouldReplace) merged.set(key, agent)
      }
      return Array.from(merged.values())
    }
    if (localAgents.length > 0) return localAgents
    return []
  }, [agents, isLocalMode, localAgents, sessionAgents])

  const visibleDisplayAgents = useMemo(() => {
    if (!isLocalMode) return displayAgents
    if (localSessionFilter === 'not-running') {
      return displayAgents.filter((agent) => isInactiveLocalSession(agent))
    }
    return displayAgents.filter((agent) => !isInactiveLocalSession(agent))
  }, [displayAgents, isLocalMode, localSessionFilter])

  const counts = useMemo(() => {
    const c = { idle: 0, busy: 0, error: 0, offline: 0 }
    for (const a of visibleDisplayAgents) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [visibleDisplayAgents])

  const roleGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of visibleDisplayAgents) {
      const role = a.role || 'Unassigned'
      if (!groups.has(role)) groups.set(role, [])
      groups.get(role)!.push(a)
    }
    return groups
  }, [visibleDisplayAgents])

  const officeLayout = useMemo(() => buildOfficeLayout(visibleDisplayAgents), [visibleDisplayAgents])

  const currentSeatMap = useMemo(() => {
    const seatMap = new Map<number, SeatPosition>()
    const zoneSeatTemplates: Record<string, Array<{ x: number; y: number }>> = {
      engineering: [{ x: 24, y: 36 }, { x: 32, y: 36 }, { x: 24, y: 42 }, { x: 32, y: 42 }],
      product: [{ x: 54, y: 36 }, { x: 62, y: 36 }, { x: 54, y: 42 }, { x: 62, y: 42 }],
      operations: [{ x: 24, y: 64 }, { x: 32, y: 64 }, { x: 24, y: 70 }, { x: 32, y: 70 }],
      research: [{ x: 50, y: 64 }, { x: 58, y: 64 }, { x: 50, y: 70 }, { x: 58, y: 70 }],
      quality: [{ x: 58, y: 64 }, { x: 66, y: 64 }, { x: 58, y: 70 }, { x: 66, y: 70 }],
      general: [{ x: 38, y: 45 }, { x: 46, y: 39 }, { x: 54, y: 45 }, { x: 62, y: 39 }, { x: 42, y: 52 }, { x: 58, y: 52 }],
    }
    const fallbackByZone: Record<string, string[]> = {
      engineering: ['operations', 'general'],
      product: ['research', 'general'],
      operations: ['engineering', 'general'],
      research: ['product', 'general'],
      quality: ['research', 'general'],
      general: ['general'],
    }

    const usageByZone = new Map<string, number>()
    const pullSeat = (zoneId: string) => {
      const templates = zoneSeatTemplates[zoneId] || zoneSeatTemplates.general
      const used = usageByZone.get(zoneId) || 0
      const chosen = templates[used % templates.length] || { x: 38, y: 47 }
      const overflowBand = Math.floor(used / templates.length)
      usageByZone.set(zoneId, used + 1)
      return {
        x: chosen.x,
        y: chosen.y + overflowBand * 3.5,
      }
    }

    for (let zoneIndex = 0; zoneIndex < officeLayout.length; zoneIndex += 1) {
      const zone = officeLayout[zoneIndex].zone
      const sortedWorkers = [...officeLayout[zoneIndex].workers].sort((a, b) => a.agent.name.localeCompare(b.agent.name))

      for (const worker of sortedWorkers) {
        const primaryTemplates = zoneSeatTemplates[zone.id] || zoneSeatTemplates.general
        const primaryUsed = usageByZone.get(zone.id) || 0
        const inPrimaryCapacity = primaryUsed < primaryTemplates.length * 2
        const targetZone = inPrimaryCapacity ? zone.id : (fallbackByZone[zone.id] || ['general'])[0]
        const seat = pullSeat(targetZone)
        const x = clamp(seat.x, 8, 92)
        const y = clamp(seat.y, 12, 92)
        seatMap.set(worker.agent.id, {
          seatKey: `${targetZone}:${worker.anchor.seatLabel}`,
          x,
          y,
        })
      }
    }
    return seatMap
  }, [officeLayout])

  const gameWorkers = useMemo(() => {
    const workers: Array<{ agent: Agent; x: number; y: number; zoneLabel: string; seatLabel: string }> = []
    for (let zoneIndex = 0; zoneIndex < officeLayout.length; zoneIndex += 1) {
      const zone = officeLayout[zoneIndex]
      for (const worker of zone.workers) {
        const seat = currentSeatMap.get(worker.agent.id)
        if (!seat) continue
        workers.push({
          agent: worker.agent,
          x: seat.x,
          y: seat.y,
          zoneLabel: zone.zone.label,
          seatLabel: worker.anchor.seatLabel,
        })
      }
    }
    return workers
  }, [currentSeatMap, officeLayout])

  const floorTiles = useMemo(() => {
    const tiles: Array<{ id: string; x: number; y: number; w: number; h: number; sprite: boolean }> = []
    const tileW = 100 / MAP_COLS
    const tileH = 100 / MAP_ROWS
    for (let row = 0; row < MAP_ROWS; row += 1) {
      for (let col = 0; col < MAP_COLS; col += 1) {
        tiles.push({
          id: `tile-${row}-${col}`,
          x: col * tileW,
          y: row * tileH,
          w: tileW,
          h: tileH,
          sprite: (row + col) % 2 === 0,
        })
      }
    }
    return tiles
  }, [])

  const movingPositionByAgent = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>()
    for (const worker of movingWorkers) {
      const eased = easeInOut(worker.progress)
      positions.set(
        worker.agentId,
        pointAlongPath(worker.path, worker.pathLengths, worker.totalLength, eased),
      )
    }
    return positions
  }, [movingWorkers])

  const movingDirectionByAgent = useMemo(() => {
    const directions = new Map<number, { dx: number; dy: number }>()
    for (const worker of movingWorkers) {
      directions.set(worker.agentId, {
        dx: worker.endX - worker.startX,
        dy: worker.endY - worker.startY,
      })
    }
    return directions
  }, [movingWorkers])

  const renderedWorkers = useMemo(() => {
    return gameWorkers.map((worker) => {
      const movingPosition = movingPositionByAgent.get(worker.agent.id)
      return {
        ...worker,
        x: movingPosition?.x ?? worker.x,
        y: movingPosition?.y ?? worker.y,
        isMoving: Boolean(movingPosition),
        direction: movingDirectionByAgent.get(worker.agent.id) || { dx: 0, dy: 0 },
        variant: getWorkerVariant(worker.agent.name),
      }
    })
  }, [gameWorkers, movingDirectionByAgent, movingPositionByAgent])

  const officePrefsKey = useMemo(() => {
    const userPart = currentUser?.id ? `u${currentUser.id}` : `guest-${currentUser?.username || 'anon'}`
    const pathPart = typeof window === 'undefined' ? 'server' : window.location.pathname.replace(/[^a-zA-Z0-9/_-]/g, '_')
    return `mc-office-prefs:v1:${dashboardMode}:${userPart}:${pathPart}`
  }, [currentUser?.id, currentUser?.username, dashboardMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(officePrefsKey)
      if (!raw) return
      const prefs = JSON.parse(raw) as PersistedOfficePrefs
      if (!prefs || prefs.version !== 1) return
      setViewMode(prefs.viewMode || 'office')
      setSidebarFilter(prefs.sidebarFilter || 'all')
      setLocalSessionFilter(
        prefs.localSessionFilter === 'not-running' ? 'not-running' : 'running',
      )
      setMapZoom(Number.isFinite(prefs.mapZoom) ? clamp(prefs.mapZoom, 0.8, 2.2) : 1)
      setMapPan({
        x: Number.isFinite(prefs.mapPan?.x) ? prefs.mapPan.x : 0,
        y: Number.isFinite(prefs.mapPan?.y) ? prefs.mapPan.y : 0,
      })
      setTimeTheme(prefs.timeTheme || 'night')
      setShowSidebar(prefs.showSidebar !== false)
      setShowMinimap(prefs.showMinimap !== false)
      setShowEvents(prefs.showEvents !== false)
      if (Array.isArray(prefs.roomLayout) && prefs.roomLayout.length > 0) {
        setRoomLayoutState(prefs.roomLayout.map((room) => ({ ...room })))
      }
      if (Array.isArray(prefs.mapProps) && prefs.mapProps.length > 0) {
        setMapPropsState(prefs.mapProps.map((prop) => ({ ...prop })))
      }
    } catch {
      // ignore corrupted local preferences
    }
  }, [officePrefsKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload: PersistedOfficePrefs = {
      version: 1,
      viewMode,
      sidebarFilter,
      localSessionFilter,
      mapZoom,
      mapPan,
      timeTheme,
      showSidebar,
      showMinimap,
      showEvents,
      roomLayout: roomLayoutState,
      mapProps: mapPropsState,
    }
    try {
      window.localStorage.setItem(officePrefsKey, JSON.stringify(payload))
    } catch {
      // ignore storage failures
    }
  }, [
    officePrefsKey,
    mapPan,
    mapPropsState,
    mapZoom,
    localSessionFilter,
    roomLayoutState,
    showEvents,
    showMinimap,
    showSidebar,
    sidebarFilter,
    timeTheme,
    viewMode,
  ])

  useEffect(() => {
    const updateThemeFromClock = () => {
      const hour = new Date().getHours()
      if (hour >= 6 && hour < 11) setTimeTheme('dawn')
      else if (hour >= 11 && hour < 17) setTimeTheme('day')
      else if (hour >= 17 && hour < 20) setTimeTheme('dusk')
      else setTimeTheme('night')
    }
    updateThemeFromClock()
    const interval = setInterval(updateThemeFromClock, 60_000)
    return () => clearInterval(interval)
  }, [])

  const themePalette = useMemo<ThemePalette>(() => {
    if (timeTheme === 'dawn') {
      return {
        shell: 'radial-gradient(circle at 20% 10%, rgba(245,158,11,0.25) 0, rgba(15,20,28,0.92) 48%, rgba(7,9,12,1) 100%)',
        gridLine: 'rgba(245,158,11,0.1)',
        haze: 'radial-gradient(circle at 52% 26%, rgba(245,158,11,0.15), transparent 62%)',
        glow: 'linear-gradient(to bottom, rgba(245,158,11,0.08), transparent 35%, rgba(0,0,0,0.2))',
        corridor: '#14181e',
        corridorStripe: 'rgba(245,158,11,0.4)',
        atmosphere: 'radial-gradient(circle at 15% 8%, rgba(245,158,11,0.18), transparent 46%), radial-gradient(circle at 82% 18%, rgba(52,211,153,0.1), transparent 40%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.15), rgba(7,9,12,0.38))',
        floorFilter: 'hue-rotate(160deg) saturate(0.7) brightness(0.65) contrast(1.1)',
        spriteFilter: 'hue-rotate(155deg) saturate(0.8) brightness(0.8)',
        roomTone: 'linear-gradient(to bottom right, rgba(245,158,11,0.1), rgba(7,9,12,0.12))',
        floorOpacityA: 0.7,
        floorOpacityB: 0.55,
        accentGlow: 'rgba(245,158,11,0.18)',
      }
    }
    if (timeTheme === 'day') {
      return {
        shell: 'radial-gradient(circle at 20% 12%, rgba(52,211,153,0.2) 0, rgba(15,20,28,0.9) 46%, rgba(7,9,12,1) 100%)',
        gridLine: 'rgba(52,211,153,0.12)',
        haze: 'radial-gradient(circle at 52% 28%, rgba(52,211,153,0.12), transparent 58%)',
        glow: 'linear-gradient(to bottom, rgba(52,211,153,0.06), transparent 30%, rgba(0,0,0,0.1))',
        corridor: '#101820',
        corridorStripe: 'rgba(52,211,153,0.35)',
        atmosphere: 'radial-gradient(circle at 18% 5%, rgba(52,211,153,0.14), transparent 45%), radial-gradient(circle at 84% 16%, rgba(34,211,238,0.08), transparent 42%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.08), rgba(7,9,12,0.24))',
        floorFilter: 'hue-rotate(165deg) saturate(0.8) brightness(0.75) contrast(1.08)',
        spriteFilter: 'hue-rotate(158deg) saturate(0.85) brightness(0.85)',
        roomTone: 'linear-gradient(to bottom right, rgba(52,211,153,0.08), rgba(7,9,12,0.08))',
        floorOpacityA: 0.75,
        floorOpacityB: 0.6,
        accentGlow: 'rgba(52,211,153,0.15)',
      }
    }
    if (timeTheme === 'dusk') {
      return {
        shell: 'radial-gradient(circle at 20% 10%, rgba(167,139,250,0.25) 0, rgba(15,20,28,0.92) 47%, rgba(7,9,12,1) 100%)',
        gridLine: 'rgba(167,139,250,0.1)',
        haze: 'radial-gradient(circle at 48% 30%, rgba(167,139,250,0.12), transparent 62%)',
        glow: 'linear-gradient(to bottom, rgba(167,139,250,0.06), transparent 30%, rgba(0,0,0,0.24))',
        corridor: '#12141e',
        corridorStripe: 'rgba(167,139,250,0.35)',
        atmosphere: 'radial-gradient(circle at 14% 10%, rgba(167,139,250,0.14), transparent 44%), radial-gradient(circle at 85% 18%, rgba(34,211,238,0.08), transparent 40%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.18), rgba(7,9,12,0.42))',
        floorFilter: 'hue-rotate(175deg) saturate(0.65) brightness(0.6) contrast(1.12)',
        spriteFilter: 'hue-rotate(168deg) saturate(0.75) brightness(0.75)',
        roomTone: 'linear-gradient(to bottom right, rgba(167,139,250,0.08), rgba(7,9,12,0.16))',
        floorOpacityA: 0.65,
        floorOpacityB: 0.5,
        accentGlow: 'rgba(167,139,250,0.14)',
      }
    }
    return {
      shell: 'radial-gradient(circle at 22% 10%, rgba(34,211,238,0.15) 0, rgba(7,9,12,0.95) 42%, rgba(7,9,12,1) 100%)',
      gridLine: 'rgba(34,211,238,0.08)',
      haze: 'radial-gradient(circle at 50% 30%, rgba(34,211,238,0.08), transparent 60%)',
      glow: 'linear-gradient(to bottom, rgba(34,211,238,0.04), transparent 30%, rgba(0,0,0,0.24))',
      corridor: '#0d1420',
      corridorStripe: 'rgba(34,211,238,0.3)',
      atmosphere: 'radial-gradient(circle at 16% 7%, rgba(34,211,238,0.1), transparent 45%), radial-gradient(circle at 82% 15%, rgba(167,139,250,0.08), transparent 42%)',
      shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.34), rgba(7,9,12,0.56))',
      floorFilter: 'hue-rotate(170deg) saturate(0.6) brightness(0.5) contrast(1.2)',
      spriteFilter: 'hue-rotate(160deg) saturate(0.7) brightness(0.7)',
      roomTone: 'linear-gradient(to bottom right, rgba(34,211,238,0.06), rgba(7,9,12,0.24))',
      floorOpacityA: 0.6,
      floorOpacityB: 0.4,
      accentGlow: 'rgba(34,211,238,0.12)',
    }
  }, [timeTheme])

  const nightSparkles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, idx) => {
        const seed = hashNumber(`night-${idx}`)
        return {
          id: idx,
          x: 6 + (seed % 88),
          y: 6 + ((seed >> 3) % 38),
          delay: (seed % 7) * 0.4,
          size: 2 + (seed % 3),
        }
      }),
    [],
  )

  const heatmapPoints = useMemo(() => {
    return renderedWorkers.map((worker) => {
      const action = agentActionOverrides.get(worker.agent.id)
      let intensity = worker.agent.status === 'busy' ? 0.95 : worker.agent.status === 'idle' ? 0.45 : 0.7
      if (action === 'focus') intensity += 0.25
      if (action === 'pair') intensity += 0.15
      if (worker.isMoving) intensity += 0.2
      const radius = worker.agent.status === 'busy' ? 14 : 10
      const hue = worker.agent.status === 'busy' ? 'rgba(255,191,84,' : worker.agent.status === 'idle' ? 'rgba(88,220,139,' : 'rgba(120,189,255,'
      return {
        id: worker.agent.id,
        x: worker.x,
        y: worker.y,
        radius,
        color: `${hue}${Math.min(0.85, Math.max(0.2, intensity)).toFixed(2)})`,
      }
    })
  }, [agentActionOverrides, renderedWorkers])

  const rosterRows = useMemo(() => {
    return gameWorkers.map(({ agent }) => {
      const minutesIdle = agent.last_seen ? Math.floor((Date.now() / 1000 - agent.last_seen) / 60) : Number.POSITIVE_INFINITY
      const needsAttention = isLocalMode && agent.status === 'idle' && minutesIdle >= 15
      return {
        agent,
        minutesIdle,
        needsAttention,
      }
    })
  }, [gameWorkers, isLocalMode])

  const filteredRosterRows = useMemo(() => {
    if (sidebarFilter === 'all') return rosterRows
    if (sidebarFilter === 'working') return rosterRows.filter((row) => row.agent.status === 'busy')
    if (sidebarFilter === 'idle') return rosterRows.filter((row) => row.agent.status === 'idle')
    return rosterRows.filter((row) => row.needsAttention)
  }, [rosterRows, sidebarFilter])

  const pathEdges = useMemo(() => {
    const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    const zoneGroups = new Map<string, Array<{ x: number; y: number }>>()
    for (const worker of gameWorkers) {
      if (!zoneGroups.has(worker.zoneLabel)) zoneGroups.set(worker.zoneLabel, [])
      zoneGroups.get(worker.zoneLabel)!.push({ x: worker.x, y: worker.y })
    }

    for (const points of zoneGroups.values()) {
      const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
      for (let i = 0; i < sorted.length - 1; i += 1) {
        edges.push({
          x1: sorted[i].x,
          y1: sorted[i].y + 2,
          x2: sorted[i + 1].x,
          y2: sorted[i + 1].y + 2,
        })
      }
    }

    // Trunk corridor and vertical connectors to mimic an office hallway system.
    edges.push({ x1: 16, y1: 47, x2: 84, y2: 47 })
    edges.push({ x1: 30, y1: 33, x2: 30, y2: 47 })
    edges.push({ x1: 60, y1: 33, x2: 60, y2: 47 })
    edges.push({ x1: 28, y1: 47, x2: 28, y2: 68 })
    edges.push({ x1: 54, y1: 47, x2: 54, y2: 68 })

    return edges
  }, [gameWorkers])

  const enqueueMovement = useCallback(
    (agent: Agent, startX: number, startY: number, endX: number, endY: number, durationMs = 2200) => {
      const blockedTiles = new Set<string>()
      for (const worker of renderedWorkersRef.current) {
        if (worker.agent.id === agent.id) continue
        const tile = toTile(worker.x, worker.y)
        blockedTiles.add(tileKey(tile.col, tile.row))
      }
      for (const moving of movingWorkersRef.current) {
        if (moving.agentId === agent.id) continue
        blockedTiles.add(moving.destinationTile)
      }
      const destination = toTile(endX, endY)
      const movement: MovingWorker = {
        id: `${agent.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        agentId: agent.id,
        initials: getInitials(agent.name),
        colorClass: hashColor(agent.name),
        startX,
        startY,
        endX,
        endY,
        startedAt: Date.now(),
        durationMs,
        progress: 0,
        ...buildPath(startX, startY, endX, endY, blockedTiles),
        destinationTile: tileKey(destination.col, destination.row),
      }
      setMovingWorkers((current) => {
        if (current.some((item) => item.agentId === agent.id)) return current
        return [...current, movement]
      })
    },
    [],
  )

  useEffect(() => {
    const prev = prevStatusRef.current
    const next = new Map<number, Agent['status']>()
    const toAnimate: number[] = []

    for (const agent of displayAgents) {
      next.set(agent.id, agent.status)
      const prevStatus = prev.get(agent.id)
      if (prevStatus && prevStatus !== agent.status) {
        toAnimate.push(agent.id)
      }
    }

    prevStatusRef.current = next

    if (toAnimate.length === 0) return
    setTransitioningAgentIds((current) => {
      const updated = new Set(current)
      for (const id of toAnimate) updated.add(id)
      return updated
    })

    for (const id of toAnimate) {
      const existingTimer = transitionTimersRef.current.get(id)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        setTransitioningAgentIds((current) => {
          const updated = new Set(current)
          updated.delete(id)
          return updated
        })
        transitionTimersRef.current.delete(id)
      }, 2200)
      transitionTimersRef.current.set(id, timer)
    }
  }, [displayAgents])

  useEffect(() => {
    const previous = previousSeatMapRef.current

    for (const agent of displayAgents) {
      const currentSeat = currentSeatMap.get(agent.id)
      const previousSeat = previous.get(agent.id)
      if (!currentSeat || !previousSeat) continue
      if (currentSeat.seatKey === previousSeat.seatKey) continue

      enqueueMovement(agent, previousSeat.x, previousSeat.y, currentSeat.x, currentSeat.y, 1800)
    }

    previousSeatMapRef.current = currentSeatMap
  }, [currentSeatMap, displayAgents, enqueueMovement])

  useEffect(() => {
    if (movingWorkers.length === 0) return

    let rafId: number | null = null
    const step = () => {
      const now = Date.now()
      setMovingWorkers((current) => {
        if (current.length === 0) return current
        const updated = current
          .map((worker) => {
            const linear = (now - worker.startedAt) / worker.durationMs
            const progress = Math.max(0, Math.min(1, linear))
            return { ...worker, progress }
          })
          .filter((worker) => worker.progress < 1)
        return updated
      })
      rafId = window.requestAnimationFrame(step)
    }

    rafId = window.requestAnimationFrame(step)
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
    }
  }, [movingWorkers.length])

  useEffect(() => {
    movingWorkersRef.current = movingWorkers
    movingAgentIdsRef.current = new Set(movingWorkers.map((worker) => worker.agentId))
  }, [movingWorkers])

  useEffect(() => {
    renderedWorkersRef.current = renderedWorkers
  }, [renderedWorkers])

  const pushOfficeEvent = useCallback((event: Omit<OfficeEvent, 'id' | 'at'>) => {
    const next: OfficeEvent = {
      ...event,
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      at: Date.now(),
    }
    setOfficeEvents((current) => [next, ...current].slice(0, 12))
  }, [])

  useEffect(() => {
    if (!isLocalMode) return
    const interval = setInterval(() => {
      const activeMovingIds = movingAgentIdsRef.current
      const idleCandidates = renderedWorkersRef.current
        .filter((worker) => worker.agent.status === 'idle' && !worker.isMoving && !activeMovingIds.has(worker.agent.id))
        .sort((a, b) => a.agent.name.localeCompare(b.agent.name))
        .slice(0, 2)

      if (idleCandidates.length === 0) return
      const cycle = Math.floor(Date.now() / 14_000)

      for (const worker of idleCandidates) {
        const waypoint = LOUNGE_WAYPOINTS[(hashNumber(worker.agent.name) + cycle) % LOUNGE_WAYPOINTS.length]
        enqueueMovement(worker.agent, worker.x, worker.y, waypoint.x, waypoint.y, 2200)

        const existingReturnTimer = roamReturnTimersRef.current.get(worker.agent.id)
        if (existingReturnTimer) clearTimeout(existingReturnTimer)
        const returnTimer = setTimeout(() => {
          const seat = currentSeatMap.get(worker.agent.id)
          if (seat) {
            enqueueMovement(worker.agent, waypoint.x, waypoint.y, seat.x, seat.y, 2200)
          }
          roamReturnTimersRef.current.delete(worker.agent.id)
        }, 2700)
        roamReturnTimersRef.current.set(worker.agent.id, returnTimer)
      }
    }, 14_000)
    return () => clearInterval(interval)
  }, [currentSeatMap, enqueueMovement, isLocalMode])

  useEffect(() => {
    const interval = setInterval(() => {
      const workers = renderedWorkersRef.current
      if (workers.length === 0) return
      const sample = workers[Math.floor(Math.random() * workers.length)]
      const mood = sample.agent.status === 'busy' ? 'good' : sample.agent.status === 'idle' ? 'warn' : 'info'
      pushOfficeEvent({
        kind: 'room',
        severity: mood,
        message: `${sample.zoneLabel}: ${sample.agent.name} status is ${statusLabel[sample.agent.status].toLowerCase()}.`,
      })
    }, 22000)
    return () => clearInterval(interval)
  }, [pushOfficeEvent])

  useEffect(() => {
    const timers = transitionTimersRef.current
    const roamTimers = roamReturnTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const timer of roamTimers.values()) clearTimeout(timer)
      roamTimers.clear()
      if (launchToastTimerRef.current) {
        clearTimeout(launchToastTimerRef.current)
        launchToastTimerRef.current = null
      }
    }
  }, [])

  const showLaunchToast = (toast: LaunchToast) => {
    setLaunchToast(toast)
    if (launchToastTimerRef.current) {
      clearTimeout(launchToastTimerRef.current)
    }
    launchToastTimerRef.current = setTimeout(() => {
      setLaunchToast(null)
      launchToastTimerRef.current = null
    }, 5000)
  }

  const executeAgentAction = useCallback((agent: Agent, action: OfficeAction) => {
    setAgentActionOverrides((current) => {
      const next = new Map(current)
      next.set(agent.id, action)
      return next
    })

    if (action === 'focus') {
      pushOfficeEvent({ kind: 'action', severity: 'good', message: `${agent.name} is now in deep focus mode.` })
      return
    }

    if (action === 'pair') {
      const partner = renderedWorkersRef.current.find((worker) => worker.agent.id !== agent.id)?.agent
      pushOfficeEvent({
        kind: 'action',
        severity: 'info',
        message: partner
          ? `${agent.name} started a pairing session with ${partner.name}.`
          : `${agent.name} started a solo pairing prep session.`,
      })
      return
    }

    const worker = renderedWorkersRef.current.find((item) => item.agent.id === agent.id)
    const waypoint = LOUNGE_WAYPOINTS[hashNumber(agent.name) % LOUNGE_WAYPOINTS.length]
    if (worker) {
      enqueueMovement(agent, worker.x, worker.y, waypoint.x, waypoint.y, 2200)
      pushOfficeEvent({ kind: 'action', severity: 'warn', message: `${agent.name} is taking a short lounge break.` })
      return
    }
    pushOfficeEvent({ kind: 'action', severity: 'warn', message: `${agent.name} requested a break.` })
  }, [enqueueMovement, pushOfficeEvent])

  const openFlightDeck = async (agent: Agent) => {
    setFlightDeckLaunching(true)
    try {
      const res = await fetch('/api/local/flight-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: agent.name,
          session: agent.session_key || '',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.installed === false) {
        if (typeof json?.downloadUrl === 'string' && json.downloadUrl) {
          setFlightDeckDownloadUrl(json.downloadUrl)
        }
        setShowFlightDeckModal(true)
        showLaunchToast({
          kind: 'info',
          title: 'Flight Deck not installed',
          detail: 'Install Flight Deck to open this session.',
        })
        return
      }
      if (!json?.launched) {
        // Fallback for environments where native launch fails.
        if (typeof json?.fallbackUrl === 'string' && json.fallbackUrl) {
          window.open(json.fallbackUrl, '_blank', 'noopener,noreferrer')
          showLaunchToast({
            kind: 'info',
            title: 'Opened browser fallback',
            detail: 'Native launch failed, opened Flight Deck web fallback.',
          })
          return
        }
        showLaunchToast({
          kind: 'error',
          title: 'Flight Deck launch failed',
          detail: json?.error || 'Unable to launch Flight Deck for this session.',
        })
        return
      }
      showLaunchToast({
        kind: 'success',
        title: 'Opened in Flight Deck',
        detail: 'Launched native Flight Deck app for this session.',
      })
    } catch {
      setShowFlightDeckModal(true)
      showLaunchToast({
        kind: 'error',
        title: 'Flight Deck request failed',
        detail: 'Could not reach local launch endpoint.',
      })
    } finally {
      setFlightDeckLaunching(false)
    }
  }

  const resetMapView = () => {
    setMapZoom(1)
    setMapPan({ x: 0, y: 0 })
  }

  const onMapWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.08 : 0.08
    setMapZoom((current) => Math.min(2.2, Math.max(0.8, Number((current + delta).toFixed(2)))))
  }

  const onMapMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    mapDragActiveRef.current = true
    mapDragOriginRef.current = { x: event.clientX, y: event.clientY }
    mapPanStartRef.current = { ...mapPan }
  }

  const onMapMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!mapDragActiveRef.current) return
    const dx = event.clientX - mapDragOriginRef.current.x
    const dy = event.clientY - mapDragOriginRef.current.y
    setMapPan({
      x: mapPanStartRef.current.x + dx,
      y: mapPanStartRef.current.y + dy,
    })
  }

  const endMapDrag = () => {
    mapDragActiveRef.current = false
  }

  const focusMapPoint = useCallback(
    (xPercent: number, yPercent: number) => {
      const viewport = mapViewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const nextPanX = rect.width / 2 - (xPercent / 100) * rect.width * mapZoom
      const nextPanY = rect.height / 2 - (yPercent / 100) * rect.height * mapZoom
      setMapPan({ x: nextPanX, y: nextPanY })
    },
    [mapZoom],
  )

  const nudgeSelectedHotspot = useCallback((dx: number, dy: number) => {
    if (!selectedHotspot) return
    if (selectedHotspot.kind === 'room') {
      setRoomLayoutState((current) =>
        current.map((room) => {
          if (room.id !== selectedHotspot.id) return room
          return {
            ...room,
            x: clamp(room.x + dx, 2, 94 - room.w),
            y: clamp(room.y + dy, 8, 94 - room.h),
          }
        }),
      )
      setSelectedHotspot((current) =>
        current ? { ...current, x: clamp(current.x + dx, 2, 98), y: clamp(current.y + dy, 8, 98) } : current,
      )
      return
    }
    setMapPropsState((current) =>
      current.map((prop) => {
        if (prop.id !== selectedHotspot.id) return prop
        return {
          ...prop,
          x: clamp(prop.x + dx, 2, 98 - prop.w),
          y: clamp(prop.y + dy, 8, 98 - prop.h),
        }
      }),
    )
    setSelectedHotspot((current) =>
      current ? { ...current, x: clamp(current.x + dx, 2, 98), y: clamp(current.y + dy, 8, 98) } : current,
    )
  }, [selectedHotspot])

  const resizeSelectedRoom = useCallback((dw: number, dh: number) => {
    if (!selectedHotspot || selectedHotspot.kind !== 'room') return
    setRoomLayoutState((current) =>
      current.map((room) => {
        if (room.id !== selectedHotspot.id) return room
        const nextW = clamp(room.w + dw, 10, 40)
        const nextH = clamp(room.h + dh, 10, 36)
        return {
          ...room,
          w: nextW,
          h: nextH,
          x: clamp(room.x, 2, 98 - nextW),
          y: clamp(room.y, 8, 98 - nextH),
        }
      }),
    )
  }, [selectedHotspot])

  const resetOfficeLayout = useCallback(() => {
    setRoomLayoutState(ROOM_LAYOUT.map((room) => ({ ...room })))
    setMapPropsState(MAP_PROPS.map((prop) => ({ ...prop })))
    setMapZoom(1)
    setMapPan({ x: 0, y: 0 })
    setShowSidebar(true)
    setShowMinimap(true)
    setShowEvents(true)
    setSelectedHotspot(null)
    pushOfficeEvent({ kind: 'room', severity: 'info', message: 'Office layout reset to defaults.' })
  }, [pushOfficeEvent])

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    const getCategory = (agent: Agent): string => {
      const name = (agent.name || '').toLowerCase()
      if (name.startsWith('habi-')) return 'Habi Lanes'
      if (name.startsWith('ops-')) return 'Ops Automation'
      if (name.includes('canary')) return 'Canary'
      if (name.startsWith('main')) return 'Core'
      if (name.startsWith('remote-')) return 'Remote'
      return 'Other'
    }

    for (const a of visibleDisplayAgents) {
      const category = getCategory(a)
      if (!groups.has(category)) groups.set(category, [])
      groups.get(category)!.push(a)
    }

    const order = ['Habi Lanes', 'Ops Automation', 'Core', 'Canary', 'Remote', 'Other']
    return new Map(
      [...groups.entries()].sort(([a], [b]) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai
        const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi
        if (av !== bv) return av - bv
        return a.localeCompare(b)
      })
    )
  }, [visibleDisplayAgents])

  const statusGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of visibleDisplayAgents) {
      const key = statusLabel[a.status] || a.status
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(a)
    }

    const order = ['Working', 'Available', 'Error', 'Away']
    return new Map(
      [...groups.entries()].sort(([a], [b]) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai
        const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi
        if (av !== bv) return av - bv
        return a.localeCompare(b)
      })
    )
  }, [visibleDisplayAgents])

  const orgGroups = useMemo(() => {
    if (orgSegmentMode === 'role') return roleGroups
    if (orgSegmentMode === 'status') return statusGroups
    return categoryGroups
  }, [categoryGroups, orgSegmentMode, roleGroups, statusGroups])

  if ((loading || (isLocalMode && localBootstrapping)) && visibleDisplayAgents.length === 0) {
    return <Loader variant="panel" label={isLocalMode ? t('loadingLocalSessions') : t('loadingOffice')} />
  }

  return (
    <div className="p-6 space-y-4">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground mr-4">
              {counts.busy > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-amber" />{t('activeCount', { count: counts.busy })}</span>}
              {counts.idle > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-mint" />{t('standbyCount', { count: counts.idle })}</span>}
              {counts.error > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-crimson" />{t('alertCount', { count: counts.error })}</span>}
              {counts.offline > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40" />{t('offlineCount', { count: counts.offline })}</span>}
            </div>
            <div className="flex rounded-md overflow-hidden border border-border">
              <Button
                variant={viewMode === 'office' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setViewMode('office')}
                className="rounded-none"
              >
                {t('buttonDeck')}
              </Button>
              <Button
                variant={viewMode === 'org-chart' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setViewMode('org-chart')}
                className="rounded-none"
              >
                {t('buttonCrewChart')}
              </Button>
            </div>
            <Button variant="secondary" size="sm" onClick={fetchAgents}>
              {t('refresh')}
            </Button>
          </div>
        </div>
      </div>

      {visibleDisplayAgents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 mx-auto mb-3 text-void-cyan/30">
            <path d="M8 1l6 4v6l-6 4-6-4V5l6-4z" />
            <path d="M8 1v14M2 5l6 4 6-4" />
          </svg>
          <p className="text-lg">{t('emptyDeck')}</p>
          <p className="text-sm mt-1">{t('emptyDeckSubtitle')}</p>
        </div>
      ) : viewMode === 'office' ? (
        <div className={`grid grid-cols-1 ${showSidebar ? 'xl:grid-cols-[220px_1fr]' : 'xl:grid-cols-1'} gap-4`}>
          {showSidebar && (
          <div className="void-panel text-foreground p-3 h-fit">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold font-mono tracking-wider text-void-cyan">{t('crewHeader')}</div>
              <div className="text-[10px] text-muted-foreground">{t('onlineCount', { count: visibleDisplayAgents.length })}</div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {([
                { key: 'all', label: t('filterAll') },
                { key: 'working', label: t('filterWorking') },
                { key: 'idle', label: t('filterIdle') },
                { key: 'attention', label: t('filterNeedsAttention') },
              ] as Array<{ key: SidebarFilter; label: string }>).map((item) => (
                <Button
                  key={item.key}
                  variant="ghost"
                  size="xs"
                  onClick={() => setSidebarFilter(item.key)}
                  className={`h-auto px-2 py-1 text-[10px] font-mono border ${
                    sidebarFilter === item.key
                      ? 'bg-void-cyan/15 border-void-cyan/30 text-void-cyan'
                      : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            {isLocalMode && (
              <div className="mb-2 flex gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setLocalSessionFilter('running')}
                  className={`flex-1 h-auto px-2 py-1 text-[10px] font-mono border ${
                    localSessionFilter === 'running'
                      ? 'bg-void-cyan/15 border-void-cyan/30 text-void-cyan'
                      : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('filterRunning')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setLocalSessionFilter('not-running')}
                  className={`flex-1 h-auto px-2 py-1 text-[10px] font-mono border ${
                    localSessionFilter === 'not-running'
                      ? 'bg-void-amber/15 border-void-amber/30 text-void-amber'
                      : 'bg-secondary border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('filterNotRunning')}
                </Button>
              </div>
            )}
            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {filteredRosterRows.map(({ agent, minutesIdle, needsAttention }) => (
                <Button
                  key={agent.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedAgent(agent)
                    const worker = renderedWorkers.find((item) => item.agent.id === agent.id)
                    if (worker) focusMapPoint(worker.x, worker.y)
                  }}
                  className={`w-full flex items-center gap-2 rounded-lg p-2 text-left h-auto ${
                    needsAttention
                      ? 'bg-amber-500/12 border border-amber-400/60 hover:bg-amber-500/20'
                      : 'bg-black/20 border border-white/5 hover:bg-black/35'
                  }`}
                >
                  <span className={`w-6 h-6 rounded ${hashColor(agent.name)} flex items-center justify-center text-[10px] font-bold text-white`}>
                    {getInitials(agent.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium truncate">{agent.name}</span>
                    <span className="block text-[10px] text-slate-300 truncate">{agent.role}</span>
                    <span className="block text-[9px] text-slate-400 truncate">
                      {agent.last_activity || t('noRecentActivity')}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`w-2 h-2 rounded-full ${statusDot[agent.status]}`} />
                    <span className={`text-[9px] ${needsAttention ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
                      {agent.status === 'busy' ? t('activeStatus') : t('idleMinutes', { minutes: minutesIdle })}
                    </span>
                  </span>
                </Button>
              ))}
              {filteredRosterRows.length === 0 && (
                <div className="text-[11px] text-slate-400 px-1 py-2">{t('noWorkersInFilter')}</div>
              )}
            </div>
          </div>
          )}

          <div
            ref={mapViewportRef}
            className="relative rounded-lg border border-border overflow-hidden min-h-[560px] cursor-grab active:cursor-grabbing shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
            style={{
              backgroundColor: 'hsl(var(--background))',
              backgroundImage: `${themePalette.shell}, linear-gradient(90deg, ${themePalette.gridLine} 1px, transparent 1px), linear-gradient(${themePalette.gridLine} 1px, transparent 1px)`,
              backgroundSize: 'auto, 64px 64px, 64px 64px',
            }}
            onWheel={onMapWheel}
            onMouseDown={onMapMouseDown}
            onMouseMove={onMapMouseMove}
            onMouseUp={endMapDrag}
            onMouseLeave={endMapDrag}
          >
            <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.haze }} />
            <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.glow }} />
            <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.atmosphere, mixBlendMode: 'screen', opacity: 0.9 }} />
            <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.shadowVeil }} />
            {timeTheme === 'dawn' && (
              <div
                className="absolute inset-0 pointer-events-none z-[2]"
                style={{
                  background: `linear-gradient(115deg, transparent 8%, ${themePalette.accentGlow} 24%, transparent 42%)`,
                  mixBlendMode: 'screen',
                  animation: 'mcSunSweep 17s ease-in-out infinite',
                }}
              />
            )}
            {timeTheme === 'day' && (
              <>
                <div
                  className="absolute inset-0 pointer-events-none z-[2]"
                  style={{
                    background: `linear-gradient(112deg, transparent 10%, ${themePalette.accentGlow} 24%, transparent 44%)`,
                    mixBlendMode: 'screen',
                    animation: 'mcSunSweep 16s ease-in-out infinite',
                  }}
                />
                <div
                  className="absolute inset-0 pointer-events-none z-[2]"
                  style={{
                    background: 'linear-gradient(96deg, transparent 24%, rgba(255,255,255,0.15) 38%, transparent 58%)',
                    mixBlendMode: 'screen',
                    animation: 'mcSunSweepReverse 20s ease-in-out infinite',
                  }}
                />
              </>
            )}
            {timeTheme === 'dusk' && (
              <div
                className="absolute inset-0 pointer-events-none z-[2]"
                style={{
                  background: `radial-gradient(circle at 50% 22%, ${themePalette.accentGlow} 0, transparent 56%)`,
                  mixBlendMode: 'screen',
                  animation: 'mcDuskPulse 7.5s ease-in-out infinite',
                }}
              />
            )}
            {timeTheme === 'night' && (
              <>
                <div
                  className="absolute inset-0 pointer-events-none z-[2]"
                  style={{
                    background: `radial-gradient(circle at 18% 12%, ${themePalette.accentGlow} 0, transparent 44%), radial-gradient(circle at 82% 16%, rgba(138,178,255,0.2) 0, transparent 42%)`,
                    mixBlendMode: 'screen',
                    animation: 'mcNightBloom 8.5s ease-in-out infinite',
                  }}
                />
                {nightSparkles.map((spark) => (
                  <div
                    key={`spark-${spark.id}`}
                    className="absolute pointer-events-none z-[2] rounded-full bg-white/80"
                    style={{
                      left: `${spark.x}%`,
                      top: `${spark.y}%`,
                      width: `${spark.size}px`,
                      height: `${spark.size}px`,
                      boxShadow: '0 0 8px rgba(180,210,255,0.9)',
                      animation: `mcTwinkle 2.6s ease-in-out ${spark.delay}s infinite`,
                    }}
                  />
                ))}
              </>
            )}

            <div className="absolute left-[8%] top-[8%] rounded-md bg-card/80 backdrop-blur-sm border border-void-cyan/20 text-void-cyan text-xs px-2 py-1 font-mono z-30">
              {t('mainDeck')}
            </div>
            <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
              <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">-</Button>
              <span className="text-[11px] font-mono w-10 text-center">{Math.round(mapZoom * 100)}%</span>
              <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.min(2.2, Number((z + 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">+</Button>
              <Button variant="ghost" size="xs" onClick={resetMapView} className="h-auto px-1.5 py-0.5 text-[11px] hover:bg-void-cyan/10">{t('resetView')}</Button>
            </div>
            <div className="absolute right-3 top-12 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
              {(['dawn', 'day', 'dusk', 'night'] as TimeTheme[]).map((item) => (
                <Button
                  key={item}
                  variant="ghost"
                  size="xs"
                  onClick={() => setTimeTheme(item)}
                  className={`h-auto px-1.5 py-0.5 text-[10px] font-mono uppercase ${timeTheme === item ? 'bg-void-cyan/20 text-void-cyan' : 'hover:bg-void-cyan/10 text-muted-foreground'}`}
                >
                  {item}
                </Button>
              ))}
            </div>
            <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
              <Button variant="ghost" size="xs" onClick={() => setShowSidebar((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showSidebar ? t('hideCrewButton') : t('showCrewButton')}</Button>
              <Button variant="ghost" size="xs" onClick={() => setShowMinimap((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showMinimap ? t('hideRadarButton') : t('showRadarButton')}</Button>
              <Button variant="ghost" size="xs" onClick={() => setShowEvents((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showEvents ? t('hideLogButton') : t('showLogButton')}</Button>
              <Button variant="ghost" size="xs" onClick={resetOfficeLayout} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{t('resetLayout')}</Button>
            </div>

            <div
              className="absolute inset-0 origin-top-left"
              style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})` }}
            >
              <div className="absolute inset-0 z-0">
                {floorTiles.map((tile) => (
                  <div
                    key={tile.id}
                    className="absolute border border-void-cyan/[0.06]"
                    style={{
                      left: `${tile.x}%`,
                      top: `${tile.y}%`,
                      width: `${tile.w}%`,
                      height: `${tile.h}%`,
                      backgroundImage: `url('/office-sprites/kenney/floorFull.png')`,
                      backgroundSize: '100% 100%',
                      opacity: tile.sprite ? themePalette.floorOpacityA : themePalette.floorOpacityB,
                      filter: themePalette.floorFilter,
                    }}
                  />
                ))}
              </div>

              {/* Corridor base */}
              <div className="absolute left-[14%] top-[45%] w-[72%] h-[6%] border-y border-void-cyan/15 shadow-[0_0_30px_hsl(var(--void-cyan)/0.1)]" style={{ backgroundColor: themePalette.corridor }} />
              <div className="absolute left-[14%] top-[47.6%] w-[72%] h-[0.7%]" style={{ backgroundColor: themePalette.corridorStripe }} />

              <div className="absolute inset-0 pointer-events-none z-[1]">
                {heatmapPoints.map((point) => (
                  <div
                    key={`heat-${point.id}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full blur-xl"
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                      width: `${point.radius * 2}px`,
                      height: `${point.radius * 2}px`,
                      background: `radial-gradient(circle, ${point.color} 0%, rgba(0,0,0,0) 72%)`,
                    }}
                  />
                ))}
              </div>

              {/* Zone rooms */}
              {roomLayoutState.map((room) => (
                <div
                  key={room.id}
                  className={`absolute border border-void-cyan/15 ${room.style} shadow-[inset_0_0_0_1px_hsl(var(--void-cyan)/0.04),0_8px_24px_rgba(0,0,0,0.3)]`}
                  style={{
                    left: `${room.x}%`,
                    top: `${room.y}%`,
                    width: `${room.w}%`,
                    height: `${room.h}%`,
                    backgroundImage: `linear-gradient(to bottom right, rgba(255,255,255,0.04), rgba(0,0,0,0.1)), url('/office-sprites/kenney/floorFull.png')`,
                    backgroundSize: 'auto, 22% 22%',
                    filter: themePalette.floorFilter,
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    const activeInRoom = renderedWorkers.filter((worker) => worker.zoneLabel === room.label).length
                    setSelectedHotspot({
                      kind: 'room',
                      id: room.id,
                      label: room.label,
                      x: room.x + room.w / 2,
                      y: room.y + room.h / 2,
                      stats: [
                        `${activeInRoom} workers present`,
                        `${Math.round(room.w * room.h)} tile area`,
                        'Click worker to inspect session',
                      ],
                    })
                    pushOfficeEvent({
                      kind: 'room',
                      severity: 'info',
                      message: `${room.label} room inspected (${activeInRoom} workers).`,
                    })
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `${themePalette.roomTone}, linear-gradient(to bottom right, rgba(255,255,255,0.08), transparent 45%)` }} />
                  <div className="absolute left-2 top-1 rounded bg-card/70 backdrop-blur-sm border border-void-cyan/15 text-void-cyan/80 text-[9px] px-1.5 py-0.5 font-mono uppercase tracking-wide">
                    {room.label}
                  </div>
                </div>
              ))}

              {/* Props / furniture */}
              {mapPropsState.map((prop) => (
                <div
                  key={prop.id}
                  className={`absolute relative border ${prop.style} ${prop.border} shadow-[0_0_12px_rgba(108,164,255,0.18)] overflow-hidden`}
                  style={{ left: `${prop.x}%`, top: `${prop.y}%`, width: `${prop.w}%`, height: `${prop.h}%` }}
                  onClick={(event) => {
                    event.stopPropagation()
                    const nearest = renderedWorkers
                      .slice()
                      .sort((a, b) => Math.hypot(a.x - prop.x, a.y - prop.y) - Math.hypot(b.x - prop.x, b.y - prop.y))[0]
                    setSelectedHotspot({
                      kind: 'desk',
                      id: prop.id,
                      label: prop.id.replace(/^desk-/, 'Desk ').replace(/^plant-/, 'Plant ').replace(/^kitchen$/, 'Lounge Rug'),
                      x: prop.x + prop.w / 2,
                      y: prop.y + prop.h / 2,
                      stats: [
                        nearest ? `Nearest worker: ${nearest.agent.name}` : 'No nearby worker',
                        `Footprint ${prop.w.toFixed(1)}x${prop.h.toFixed(1)}`,
                        'Use action buttons in agent modal',
                      ],
                    })
                    pushOfficeEvent({
                      kind: 'desk',
                      severity: 'info',
                      message: `${prop.id} inspected${nearest ? ` near ${nearest.agent.name}` : ''}.`,
                    })
                  }}
                >
                  <Image
                    src={getPropSprite(prop.id)}
                    alt=""
                    aria-hidden="true"
                    fill
                    unoptimized
                    className="object-contain opacity-95"
                    style={{ imageRendering: 'pixelated', filter: themePalette.spriteFilter }}
                    draggable={false}
                  />
                </div>
              ))}

              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                {pathEdges.map((edge, idx) => (
                  <line
                    key={`edge-${idx}`}
                    x1={`${edge.x1}%`}
                    y1={`${edge.y1}%`}
                    x2={`${edge.x2}%`}
                    y2={`${edge.y2}%`}
                    stroke="rgba(170, 203, 255, 0.42)"
                    strokeWidth="2"
                    strokeDasharray="4 6"
                  />
                ))}
              </svg>

              {renderedWorkers.map(({ agent, x, y, zoneLabel, seatLabel, isMoving, direction }) => (
                <div key={agent.id}>
                  <div
                    className="absolute -translate-x-1/2 pointer-events-none"
                    style={{ left: `${x}%`, top: `calc(${y}% - 14px)` }}
                  >
                    <Image
                      src="/office-sprites/kenney/chairDesk.png"
                      alt=""
                      aria-hidden="true"
                      width={22}
                      height={21}
                      unoptimized
                      className="w-6 h-6 object-contain opacity-90"
                      style={{ imageRendering: 'pixelated' }}
                      draggable={false}
                    />
                  </div>
                  <div
                    className="absolute -translate-x-1/2 pointer-events-none"
                    style={{ left: `${x}%`, top: `calc(${y}% - 56px)` }}
                  >
                    <div className="relative w-16 h-9">
                      <Image
                        src="/office-sprites/kenney/desk.png"
                        alt=""
                        aria-hidden="true"
                        width={64}
                        height={32}
                        unoptimized
                        className="w-16 h-9 object-contain opacity-95"
                        style={{ imageRendering: 'pixelated', filter: themePalette.spriteFilter }}
                        draggable={false}
                      />
                      <Image
                        src="/office-sprites/kenney/computerScreen.png"
                        alt=""
                        aria-hidden="true"
                        width={20}
                        height={6}
                        unoptimized
                        className="absolute left-1/2 -translate-x-1/2 top-[6px] w-7 h-2 object-contain opacity-95"
                        style={{ imageRendering: 'pixelated', filter: themePalette.spriteFilter }}
                        draggable={false}
                      />
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => setSelectedAgent(agent)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 hover:scale-110 h-auto p-0 rounded-none hover:bg-transparent"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 border border-white/10 text-white text-[11px] px-2 py-0.5 shadow-[0_0_12px_rgba(0,0,0,0.4)]">
                      <span className={`inline-block w-2 h-2 rounded-full ${statusDot[agent.status]} mr-1`} />
                      {agent.name}
                    </div>
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-sm">
                      <span className={`${agent.status === 'busy' ? 'animate-bounce' : 'animate-pulse'}`}>{getStatusEmote(agent.status)}</span>
                    </div>
                    <div className="relative w-8 h-12 mx-auto">
                      <div
                        className={`absolute inset-0 ${transitioningAgentIds.has(agent.id) || isMoving ? 'animate-pulse' : ''}`}
                        style={{
                          backgroundImage: `url('/office-sprites/cc0-hero/player_full_animation.png')`,
                          backgroundRepeat: 'no-repeat',
                          backgroundSize: `${HERO_SHEET_COLS * 100}% ${HERO_SHEET_ROWS * 100}%`,
                          backgroundPosition: (() => {
                            const frame = getWorkerHeroFrame(agent.status, isMoving, spriteFrame)
                            const xPct = (frame.col / (HERO_SHEET_COLS - 1)) * 100
                            const yPct = (frame.row / (HERO_SHEET_ROWS - 1)) * 100
                            return `${xPct}% ${yPct}%`
                          })(),
                          imageRendering: 'pixelated',
                          filter: themePalette.spriteFilter,
                          transform: isMoving && Math.abs(direction.dx) > Math.abs(direction.dy) && direction.dx < 0 ? 'scaleX(-1)' : undefined,
                          transformOrigin: 'center',
                        }}
                      />
                      <div className={`absolute left-[8px] top-[14px] w-4 h-3 ${hashColor(agent.name)} border border-black/60`} />
                    </div>
                    {!isMoving && <div className="text-[9px] text-slate-300 font-mono mt-0.5">#{seatLabel}</div>}
                  </Button>

                  {agentActionOverrides.has(agent.id) && (
                    <div
                      className="absolute -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-cyan-200"
                      style={{ left: `${x}%`, top: `calc(${y}% - 24px)` }}
                    >
                      {agentActionOverrides.get(agent.id)}
                    </div>
                  )}

                  {(transitioningAgentIds.has(agent.id) || isMoving) && (
                    <div
                      className="absolute -translate-x-1/2 text-[9px] text-slate-200/85 font-medium px-1.5 py-0.5 rounded bg-black/45 border border-white/10"
                      style={{ left: `${x}%`, top: `calc(${y}% + 22px)` }}
                    >
                      {t('moving')}
                    </div>
                  )}

                  <div
                    className="absolute text-[9px] text-slate-500/70 font-mono pointer-events-none"
                    style={{ left: `${x}%`, top: `calc(${y}% + 38px)` }}
                  >
                    {zoneLabel}
                  </div>
                </div>
              ))}
            </div>

            {showMinimap && (
            <div
              className="absolute right-3 bottom-3 z-30 w-44 h-28 rounded-md border border-void-cyan/15 bg-card/85 backdrop-blur-sm p-1.5"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                const target = event.currentTarget
                const rect = target.getBoundingClientRect()
                const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)
                const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
                focusMapPoint(x, y)
              }}
            >
              <div className="text-[9px] text-void-cyan/60 font-mono uppercase tracking-wider mb-1">{t('radarLabel')}</div>
              <div className="relative w-full h-[calc(100%-16px)] rounded-sm overflow-hidden border border-void-cyan/10 bg-background">
                {roomLayoutState.map((room) => (
                  <div
                    key={`mini-${room.id}`}
                    className="absolute border border-void-cyan/15 bg-void-cyan/5"
                    style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%` }}
                  />
                ))}
                <div className="absolute left-[14%] top-[47%] w-[72%] h-[4%] bg-void-cyan/20" />
                {renderedWorkers.map((worker) => (
                  <Button
                    key={`mini-worker-${worker.agent.id}`}
                    variant="ghost"
                    className={`absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ${hashColor(worker.agent.name)} border border-black/40 h-auto p-0 min-w-0 hover:bg-transparent`}
                    style={{ left: `${worker.x}%`, top: `${worker.y}%` }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedAgent(worker.agent)
                      focusMapPoint(worker.x, worker.y)
                    }}
                    title={worker.agent.name}
                  />
                ))}
              </div>
            </div>
            )}

            {showEvents && (
            <div
              className="absolute left-3 bottom-3 z-30 w-72 rounded-md border border-void-cyan/15 bg-card/88 backdrop-blur-sm p-2.5 space-y-2"
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="text-[10px] text-void-cyan/60 font-mono uppercase tracking-wider">{t('deckLog')}</div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-amber" />{t('legendActive')}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-mint" />{t('legendStandby')}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-cyan" />{t('legendOther')}</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1" onWheel={(event) => event.stopPropagation()}>
                {officeEvents.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">{t('noEventsYet')}</div>
                )}
                {officeEvents.map((event) => (
                  <div key={event.id} className="text-[11px] rounded px-2 py-1 bg-secondary/50 border border-border">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`uppercase font-mono text-[9px] ${
                          event.severity === 'good'
                            ? 'text-void-mint'
                            : event.severity === 'warn'
                              ? 'text-void-amber'
                              : 'text-void-cyan'
                        }`}
                      >
                        {event.kind}
                      </span>
                      <span className="text-muted-foreground text-[9px]">{formatLastSeen(Math.floor(event.at / 1000))}</span>
                    </div>
                    <div className="text-foreground/80">{event.message}</div>
                  </div>
                ))}
              </div>
              {selectedHotspot && (
                <div className="rounded border border-void-cyan/15 bg-secondary/50 p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-foreground">{selectedHotspot.label}</div>
                    <div className="text-[9px] font-mono uppercase text-void-cyan/60">{selectedHotspot.kind}</div>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {selectedHotspot.stats.map((line) => (
                      <div key={line} className="text-[10px] text-slate-300">{line}</div>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0, -1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotUp')}</Button>
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(-1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotLeft')}</Button>
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotRight')}</Button>
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0, 1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotDown')}</Button>
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(-0.5, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotFineMinusX')}</Button>
                    <Button variant="outline" size="xs" onClick={() => nudgeSelectedHotspot(0.5, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotFinePlusX')}</Button>
                  </div>
                  {selectedHotspot.kind === 'room' && (
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotWider')}</Button>
                      <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(-1, 0)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotNarrower')}</Button>
                      <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(0, 1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotTaller')}</Button>
                      <Button variant="outline" size="xs" onClick={() => resizeSelectedRoom(0, -1)} className="h-auto py-1 text-[10px] border-white/10 hover:bg-white/10">{t('hotspotShorter')}</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('segmentedBy')}{' '}
              <span className="font-medium text-foreground">
                {orgSegmentMode === 'category' ? t('segmentCategory') : orgSegmentMode === 'role' ? t('segmentRole') : t('segmentStatus')}
              </span>
            </div>
            <div className="flex rounded-md overflow-hidden border border-border">
              <Button
                variant={orgSegmentMode === 'category' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setOrgSegmentMode('category')}
                className="rounded-none"
              >
                {t('segmentCategory')}
              </Button>
              <Button
                variant={orgSegmentMode === 'role' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setOrgSegmentMode('role')}
                className="rounded-none"
              >
                {t('segmentRole')}
              </Button>
              <Button
                variant={orgSegmentMode === 'status' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setOrgSegmentMode('status')}
                className="rounded-none"
              >
                {t('segmentStatus')}
              </Button>
            </div>
          </div>

          {[...orgGroups.entries()].map(([segment, members]) => (
            <div key={segment} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-6 bg-primary rounded-full" />
                <h3 className="font-semibold text-foreground">{segment}</h3>
                <span className="text-xs text-muted-foreground ml-1">({members.length})</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {members.map(agent => (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${statusGlow[agent.status]}`}
                    style={{ background: 'var(--card)' }}
                  >
                    <div className={`w-8 h-8 rounded-full ${hashColor(agent.name)} flex items-center justify-center text-white font-bold text-xs`}>
                      {getInitials(agent.name)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{agent.name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot[agent.status]}`} />
                        {agent.status === 'idle' ? t('legendStandby') : agent.status === 'busy' ? t('legendActive') : statusLabel[agent.status]}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAgent(null)}>
          <div className="bg-card border border-border rounded-lg max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-14 h-14 rounded-full ${hashColor(selectedAgent.name)} flex items-center justify-center text-white font-bold text-lg ring-2 ring-offset-2 ring-offset-card ${selectedAgent.status === 'busy' ? 'ring-yellow-500' : selectedAgent.status === 'idle' ? 'ring-green-500' : selectedAgent.status === 'error' ? 'ring-red-500' : 'ring-gray-600'}`}>
                  {getInitials(selectedAgent.name)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{selectedAgent.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedAgent.role}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => setSelectedAgent(null)} className="text-muted-foreground hover:text-foreground text-xl w-6 h-6">×</Button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${statusDot[selectedAgent.status]}`} />
                <span className="font-medium text-foreground">{selectedAgent.status === 'idle' ? t('legendStandby') : selectedAgent.status === 'busy' ? t('legendActive') : statusLabel[selectedAgent.status]}</span>
                <span className="text-muted-foreground ml-auto">{formatLastSeen(selectedAgent.last_seen, t as (key: string, values?: Record<string, unknown>) => string)}</span>
              </div>

              {selectedAgent.last_activity && (
                <div className="bg-secondary rounded-lg p-3">
                  <span className="text-xs text-muted-foreground block mb-1">{t('currentActivity')}</span>
                  <span className="text-foreground text-sm">{selectedAgent.last_activity}</span>
                </div>
              )}

              {selectedAgent.taskStats && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-foreground">{selectedAgent.taskStats.total}</div>
                    <div className="text-[10px] text-muted-foreground">{t('taskStatTotal')}</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-blue-400">{selectedAgent.taskStats.assigned}</div>
                    <div className="text-[10px] text-muted-foreground">{t('taskStatAssigned')}</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-yellow-400">{selectedAgent.taskStats.in_progress}</div>
                    <div className="text-[10px] text-muted-foreground">{t('taskStatActive')}</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-green-400">{selectedAgent.taskStats.completed}</div>
                    <div className="text-[10px] text-muted-foreground">{t('taskStatDone')}</div>
                  </div>
                </div>
              )}

              {selectedAgent.session_key && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{t('sessionLabel')}</span> <code className="font-mono">{selectedAgent.session_key}</code>
                </div>
              )}

              <div className="pt-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{t('quickActions')}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => executeAgentAction(selectedAgent, 'focus')}
                    className="text-[11px]"
                  >
                    {t('actionFocus')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => executeAgentAction(selectedAgent, 'pair')}
                    className="text-[11px]"
                  >
                    {t('actionPair')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => executeAgentAction(selectedAgent, 'break')}
                    className="text-[11px]"
                  >
                    {t('actionBreak')}
                  </Button>
                </div>
              </div>

              {isLocalMode && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => openFlightDeck(selectedAgent)}
                    disabled={flightDeckLaunching}
                    className="w-full text-xs"
                  >
                    {flightDeckLaunching ? t('openingFlightDeck') : t('openFlightDeck')}
                  </Button>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {t('flightDeckCompanion')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showFlightDeckModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowFlightDeckModal(false)}>
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{t('flightDeckRequired')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('flightDeckDescription')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowFlightDeckModal(false)}
                className="text-muted-foreground hover:text-foreground text-xl w-6 h-6"
              >
                ×
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              {t('flightDeckNotInstalled')}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowFlightDeckModal(false)}
              >
                {t('maybeLater')}
              </Button>
              <a
                href={flightDeckDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth inline-flex items-center"
              >
                {t('downloadFlightDeck')}
              </a>
            </div>
          </div>
        </div>
      )}

      {launchToast && (
        <div className="fixed right-4 bottom-4 z-[70] max-w-sm rounded-lg border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-2xl">
          <div className="flex items-start gap-2">
            <span
              className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${
                launchToast.kind === 'success'
                  ? 'bg-green-400'
                  : launchToast.kind === 'info'
                    ? 'bg-blue-400'
                    : 'bg-red-400'
              }`}
            />
            <div>
              <div className="text-sm font-semibold text-foreground">{launchToast.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{launchToast.detail}</div>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
        @keyframes mcSunSweep {
          0% { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
          50% { transform: translateX(8%) translateY(2%); opacity: 0.56; }
          100% { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
        }
        @keyframes mcSunSweepReverse {
          0% { transform: translateX(8%) translateY(2%); opacity: 0.18; }
          50% { transform: translateX(-8%) translateY(-2%); opacity: 0.32; }
          100% { transform: translateX(8%) translateY(2%); opacity: 0.18; }
        }
        @keyframes mcDuskPulse {
          0% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 0.52; transform: scale(1.03); }
          100% { opacity: 0.28; transform: scale(1); }
        }
        @keyframes mcNightBloom {
          0% { opacity: 0.25; }
          50% { opacity: 0.5; }
          100% { opacity: 0.25; }
        }
        @keyframes mcTwinkle {
          0% { opacity: 0.25; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.15); }
          100% { opacity: 0.25; transform: scale(0.9); }
        }
      `}</style>
    </div>
  )
}
