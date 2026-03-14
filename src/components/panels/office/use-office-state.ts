'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { MouseEvent, WheelEvent } from 'react'
import { useMissionControl, Agent } from '@/store'
import { buildOfficeLayout } from '@/lib/office-layout'
import type {
  ViewMode,
  OrgSegmentMode,
  SessionAgentRow,
  SeatPosition,
  MovingWorker,
  SidebarFilter,
  MapRoom,
  MapProp,
  LaunchToast,
  OfficeAction,
  TimeTheme,
  OfficeHotspot,
  OfficeEvent,
  ThemePalette,
  PersistedOfficePrefs,
  WorkerVariant,
} from './types'
import {
  statusLabel,
  getInitials,
  hashColor,
  hashNumber,
  easeInOut,
  inferLocalRole,
  isInactiveLocalSession,
  getWorkerVariant,
  clamp,
  toTile,
  tileKey,
  buildPath,
  pointAlongPath,
  MAP_COLS,
  MAP_ROWS,
  ROOM_LAYOUT,
  MAP_PROPS,
  LOUNGE_WAYPOINTS,
} from './types'

export function useOfficeState() {
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
        shell: 'radial-gradient(circle at 20% 10%, rgba(255,177,108,0.52) 0, rgba(78,82,132,0.9) 48%, rgba(19,24,41,1) 100%)',
        gridLine: 'rgba(255,212,166,0.2)',
        haze: 'radial-gradient(circle at 52% 26%, rgba(255,205,146,0.34), transparent 62%)',
        glow: 'linear-gradient(to bottom, rgba(255,238,210,0.16), transparent 35%, rgba(0,0,0,0.2))',
        corridor: '#3f3f54',
        corridorStripe: '#ffca95',
        atmosphere: 'radial-gradient(circle at 15% 8%, rgba(255,191,122,0.34), transparent 46%), radial-gradient(circle at 82% 18%, rgba(255,224,184,0.18), transparent 40%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(27,22,35,0.15), rgba(13,17,33,0.38))',
        floorFilter: 'hue-rotate(-8deg) saturate(1.02) brightness(1.1) contrast(1.03)',
        spriteFilter: 'hue-rotate(-4deg) saturate(1.04) brightness(1.05)',
        roomTone: 'linear-gradient(to bottom right, rgba(255,219,167,0.2), rgba(82,67,96,0.12))',
        floorOpacityA: 0.95,
        floorOpacityB: 0.8,
        accentGlow: 'rgba(255,183,120,0.32)',
      }
    }
    if (timeTheme === 'day') {
      return {
        shell: 'radial-gradient(circle at 20% 12%, rgba(164,203,255,0.48) 0, rgba(41,76,128,0.88) 46%, rgba(16,26,46,1) 100%)',
        gridLine: 'rgba(183,218,255,0.24)',
        haze: 'radial-gradient(circle at 52% 28%, rgba(196,236,255,0.25), transparent 58%)',
        glow: 'linear-gradient(to bottom, rgba(255,255,255,0.14), transparent 30%, rgba(4,16,33,0.1))',
        corridor: '#3a4258',
        corridorStripe: '#b8d5ff',
        atmosphere: 'radial-gradient(circle at 18% 5%, rgba(183,230,255,0.3), transparent 45%), radial-gradient(circle at 84% 16%, rgba(216,241,255,0.2), transparent 42%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(16,30,49,0.08), rgba(9,18,35,0.24))',
        floorFilter: 'hue-rotate(6deg) saturate(1.08) brightness(1.2) contrast(1.04)',
        spriteFilter: 'hue-rotate(4deg) saturate(1.08) brightness(1.08)',
        roomTone: 'linear-gradient(to bottom right, rgba(196,236,255,0.18), rgba(81,116,171,0.08))',
        floorOpacityA: 0.98,
        floorOpacityB: 0.86,
        accentGlow: 'rgba(176,232,255,0.3)',
      }
    }
    if (timeTheme === 'dusk') {
      return {
        shell: 'radial-gradient(circle at 20% 10%, rgba(222,129,187,0.44) 0, rgba(45,44,91,0.92) 47%, rgba(12,14,30,1) 100%)',
        gridLine: 'rgba(224,169,255,0.2)',
        haze: 'radial-gradient(circle at 48% 30%, rgba(247,172,220,0.24), transparent 62%)',
        glow: 'linear-gradient(to bottom, rgba(255,220,245,0.1), transparent 30%, rgba(0,0,0,0.24))',
        corridor: '#413b58',
        corridorStripe: '#d7b0ff',
        atmosphere: 'radial-gradient(circle at 14% 10%, rgba(255,160,198,0.27), transparent 44%), radial-gradient(circle at 85% 18%, rgba(198,150,255,0.18), transparent 40%)',
        shadowVeil: 'linear-gradient(to bottom, rgba(29,20,46,0.18), rgba(9,9,24,0.42))',
        floorFilter: 'hue-rotate(20deg) saturate(1.05) brightness(0.95) contrast(1.05)',
        spriteFilter: 'hue-rotate(18deg) saturate(1.08) brightness(0.98)',
        roomTone: 'linear-gradient(to bottom right, rgba(244,164,209,0.17), rgba(88,62,126,0.16))',
        floorOpacityA: 0.9,
        floorOpacityB: 0.75,
        accentGlow: 'rgba(232,141,206,0.27)',
      }
    }
    return {
      shell: 'radial-gradient(circle at 22% 10%, rgba(57,93,161,0.72) 0, rgba(12,20,38,0.95) 42%, rgba(8,12,22,1) 100%)',
      gridLine: 'rgba(115,139,191,0.2)',
      haze: 'radial-gradient(circle at 50% 30%, rgba(89,148,255,0.19), transparent 60%)',
      glow: 'linear-gradient(to bottom, rgba(240,248,255,0.05), transparent 30%, rgba(0,0,0,0.24))',
      corridor: '#303746',
      corridorStripe: '#9cc2ff',
      atmosphere: 'radial-gradient(circle at 16% 7%, rgba(93,141,255,0.26), transparent 45%), radial-gradient(circle at 82% 15%, rgba(133,169,255,0.16), transparent 42%)',
      shadowVeil: 'linear-gradient(to bottom, rgba(8,13,25,0.34), rgba(5,8,18,0.56))',
      floorFilter: 'hue-rotate(26deg) saturate(0.9) brightness(0.72) contrast(1.1)',
      spriteFilter: 'hue-rotate(18deg) saturate(0.94) brightness(0.84)',
      roomTone: 'linear-gradient(to bottom right, rgba(94,133,207,0.17), rgba(19,27,52,0.24))',
      floorOpacityA: 0.84,
      floorOpacityB: 0.66,
      accentGlow: 'rgba(116,152,255,0.26)',
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

  return {
    isLocalMode,
    loading,
    localBootstrapping,
    viewMode,
    setViewMode,
    orgSegmentMode,
    setOrgSegmentMode,
    selectedAgent,
    setSelectedAgent,
    showFlightDeckModal,
    setShowFlightDeckModal,
    flightDeckDownloadUrl,
    flightDeckLaunching,
    launchToast,
    selectedHotspot,
    setSelectedHotspot,
    agentActionOverrides,
    officeEvents,
    roomLayoutState,
    mapPropsState,
    showSidebar,
    setShowSidebar,
    showMinimap,
    setShowMinimap,
    showEvents,
    setShowEvents,
    localSessionFilter,
    setLocalSessionFilter,
    sidebarFilter,
    setSidebarFilter,
    spriteFrame,
    timeTheme,
    setTimeTheme,
    mapZoom,
    setMapZoom,
    mapPan,
    setMapPan,
    mapViewportRef,
    transitioningAgentIds,
    visibleDisplayAgents,
    counts,
    renderedWorkers,
    filteredRosterRows,
    floorTiles,
    heatmapPoints,
    pathEdges,
    nightSparkles,
    themePalette,
    orgGroups,
    fetchAgents,
    resetMapView,
    onMapWheel,
    onMapMouseDown,
    onMapMouseMove,
    endMapDrag,
    focusMapPoint,
    nudgeSelectedHotspot,
    resizeSelectedRoom,
    resetOfficeLayout,
    pushOfficeEvent,
    executeAgentAction,
    openFlightDeck,
  }
}
