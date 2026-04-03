'use client'

// Thin shell — all state management lives here.
// Rendering is delegated to focused sub-components in ./office/.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { MouseEvent, WheelEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl, Agent } from '@/store'
import {
  // Types
  ViewMode,
  OrgSegmentMode,
  SidebarFilter,
  OfficeAction,
  SessionAgentRow,
  SeatPosition,
  MovingWorker,
  MapRoom,
  MapProp,
  LaunchToast,
  OfficeHotspot,
  OfficeEvent,
  RenderedWorker,
  // Constants
  ROOM_LAYOUT,
  MAP_PROPS,
  LOUNGE_WAYPOINTS,
  toTile,
  tileKey,
  buildPath,
  // Utils
  getInitials,
  hashColor,
  hashNumber,
  statusLabel,
  isInactiveLocalSession,
  clamp,
  // Sub-components
  OfficeSidebar,
  OfficeMapCanvas,
  OfficeMinimap,
  OfficeDeckLog,
  OrgChart,
  AgentModal,
  FlightDeckModal,
  OfficeLaunchToast,
  // Hooks
  useThemePalette,
  useOfficeSeatMap,
  useOrgGroups,
  useOfficePrefs,
} from './office'

export function OfficePanel() {
  const { agents, dashboardMode, currentUser } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'

  // ── Data state ────────────────────────────────────────────────────────────
  const [localAgents, setLocalAgents] = useState<Agent[]>([])
  const [sessionAgents, setSessionAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [localBootstrapping, setLocalBootstrapping] = useState(isLocalMode)
  const [error, setError] = useState<string | null>(null)

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('office')
  const [orgSegmentMode, setOrgSegmentMode] = useState<OrgSegmentMode>('category')
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all')
  const [localSessionFilter, setLocalSessionFilter] = useState<'running' | 'not-running'>('running')
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showEvents, setShowEvents] = useState(true)

  // ── Selection / overlay state ─────────────────────────────────────────────
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedHotspot, setSelectedHotspot] = useState<OfficeHotspot | null>(null)
  const [showFlightDeckModal, setShowFlightDeckModal] = useState(false)
  const [flightDeckDownloadUrl, setFlightDeckDownloadUrl] = useState('https://flightdeck.example.com/download')
  const [flightDeckLaunching, setFlightDeckLaunching] = useState(false)
  const [launchToast, setLaunchToast] = useState<LaunchToast | null>(null)
  const [agentActionOverrides, setAgentActionOverrides] = useState<Map<number, OfficeAction>>(new Map())
  const [officeEvents, setOfficeEvents] = useState<OfficeEvent[]>([])

  // ── Layout / map state ────────────────────────────────────────────────────
  const [roomLayoutState, setRoomLayoutState] = useState<MapRoom[]>(() => ROOM_LAYOUT.map((room) => ({ ...room })))
  const [mapPropsState, setMapPropsState] = useState<MapProp[]>(() => MAP_PROPS.map((prop) => ({ ...prop })))
  const [spriteFrame, setSpriteFrame] = useState(0)
  const [mapZoom, setMapZoom] = useState(1)
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 })

  // ── Animation state ───────────────────────────────────────────────────────
  const [transitioningAgentIds, setTransitioningAgentIds] = useState<Set<number>>(new Set())
  const [movingWorkers, setMovingWorkers] = useState<MovingWorker[]>([])

  // ── Refs ──────────────────────────────────────────────────────────────────
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
  const renderedWorkersRef = useRef<RenderedWorker[]>([])
  const previousSeatMapRef = useRef<Map<number, SeatPosition>>(new Map())

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    let nextLocalAgents: Agent[] = []
    let nextSessionAgents: Agent[] = []
    setError(null)

    try {
      const [agentRes, sessionRes] = await Promise.all([
        fetch('/api/agents', { signal: AbortSignal.timeout(8000) }),
        isLocalMode ? fetch('/api/sessions', { signal: AbortSignal.timeout(8000) }) : Promise.resolve(null),
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
          const candidate: Agent = {
            id: -5000 - idx,
            name,
            role: String(row.kind || 'local-session'),
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
    } catch {
      setError('Failed to load. Please try again.')
    }

    if (isLocalMode) {
      const hasAnyAgents = nextLocalAgents.length > 0 || nextSessionAgents.length > 0
      if (hasAnyAgents) setLocalBootstrapping(false)
      if (!hasAnyAgents && localBootstrapRetries.current < 5) {
        localBootstrapRetries.current += 1
        setLoading(true)
        setTimeout(() => { void fetchAgents() }, 700)
        return
      }
    }

    setLoading(false)
  }, [isLocalMode])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  useEffect(() => {
    if (!isLocalMode) { setLocalBootstrapping(false); return }
    setLocalBootstrapping(true)
    const bootstrapTimer = setTimeout(() => setLocalBootstrapping(false), 4500)
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

  // ── Derived agent lists ───────────────────────────────────────────────────
  const displayAgents = useMemo(() => {
    if (agents.length > 0) return agents
    if (isLocalMode) {
      const merged = new Map<string, Agent>()
      for (const agent of [...sessionAgents, ...localAgents]) {
        const key = String(agent.name || '').trim().toLowerCase()
        if (!key) continue
        const existing = merged.get(key)
        if (!existing) { merged.set(key, agent); continue }
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
    if (localSessionFilter === 'not-running') return displayAgents.filter((a) => isInactiveLocalSession(a))
    return displayAgents.filter((a) => !isInactiveLocalSession(a))
  }, [displayAgents, isLocalMode, localSessionFilter])

  const counts = useMemo(() => {
    const c = { idle: 0, busy: 0, error: 0, offline: 0 }
    for (const a of visibleDisplayAgents) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [visibleDisplayAgents])

  // ── Delegated hooks ───────────────────────────────────────────────────────
  const { timeTheme, setTimeTheme, themePalette } = useThemePalette()

  const {
    currentSeatMap,
    gameWorkers,
    renderedWorkers,
    floorTiles,
    nightSparkles,
    heatmapPoints,
    pathEdges,
    filteredRosterRows,
  } = useOfficeSeatMap({ visibleDisplayAgents, movingWorkers, agentActionOverrides, sidebarFilter, isLocalMode })

  const { orgGroups } = useOrgGroups(visibleDisplayAgents, orgSegmentMode)

  useOfficePrefs({
    currentUserId: currentUser?.id,
    currentUserName: currentUser?.username,
    dashboardMode,
    state: { viewMode, sidebarFilter, localSessionFilter, mapZoom, mapPan, timeTheme, showSidebar, showMinimap, showEvents, roomLayoutState, mapPropsState },
    setters: { setViewMode, setSidebarFilter, setLocalSessionFilter, setMapZoom, setMapPan, setTimeTheme, setShowSidebar, setShowMinimap, setShowEvents, setRoomLayoutState, setMapPropsState },
  })

  // Declared before animation effects to avoid TDZ — effects below depend on this callback.
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
        startX, startY, endX, endY,
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

  // ── Animation effects ─────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevStatusRef.current
    const next = new Map<number, Agent['status']>()
    const toAnimate: number[] = []
    for (const agent of displayAgents) {
      next.set(agent.id, agent.status)
      const prevStatus = prev.get(agent.id)
      if (prevStatus && prevStatus !== agent.status) toAnimate.push(agent.id)
    }
    prevStatusRef.current = next
    if (toAnimate.length === 0) return
    setTransitioningAgentIds((current) => {
      const updated = new Set(current)
      for (const id of toAnimate) updated.add(id)
      return updated
    })
    for (const id of toAnimate) {
      const existing = transitionTimersRef.current.get(id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        setTransitioningAgentIds((current) => { const updated = new Set(current); updated.delete(id); return updated })
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
      if (!currentSeat || !previousSeat || currentSeat.seatKey === previousSeat.seatKey) continue
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
        return current
          .map((worker) => ({ ...worker, progress: Math.max(0, Math.min(1, (now - worker.startedAt) / worker.durationMs)) }))
          .filter((worker) => worker.progress < 1)
      })
      rafId = window.requestAnimationFrame(step)
    }
    rafId = window.requestAnimationFrame(step)
    return () => { if (rafId != null) window.cancelAnimationFrame(rafId) }
  }, [movingWorkers.length])

  useEffect(() => {
    movingWorkersRef.current = movingWorkers
    movingAgentIdsRef.current = new Set(movingWorkers.map((w) => w.agentId))
  }, [movingWorkers])

  useEffect(() => { renderedWorkersRef.current = renderedWorkers }, [renderedWorkers])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const timers = transitionTimersRef.current
    const roamTimers = roamReturnTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const timer of roamTimers.values()) clearTimeout(timer)
      roamTimers.clear()
      if (launchToastTimerRef.current) { clearTimeout(launchToastTimerRef.current); launchToastTimerRef.current = null }
    }
  }, [])

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const pushOfficeEvent = useCallback((event: Omit<OfficeEvent, 'id' | 'at'>) => {
    const next: OfficeEvent = { ...event, id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, at: Date.now() }
    setOfficeEvents((current) => [next, ...current].slice(0, 12))
  }, [])

  const executeAgentAction = useCallback((agent: Agent, action: OfficeAction) => {
    setAgentActionOverrides((current) => { const next = new Map(current); next.set(agent.id, action); return next })
    if (action === 'focus') {
      pushOfficeEvent({ kind: 'action', severity: 'good', message: `${agent.name} is now in deep focus mode.` })
      return
    }
    if (action === 'pair') {
      const partner = renderedWorkersRef.current.find((w) => w.agent.id !== agent.id)?.agent
      pushOfficeEvent({
        kind: 'action', severity: 'info',
        message: partner ? `${agent.name} started a pairing session with ${partner.name}.` : `${agent.name} started a solo pairing prep session.`,
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

  const focusMapPoint = useCallback((xPercent: number, yPercent: number) => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    setMapPan({ x: rect.width / 2 - (xPercent / 100) * rect.width * mapZoom, y: rect.height / 2 - (yPercent / 100) * rect.height * mapZoom })
  }, [mapZoom])

  const nudgeSelectedHotspot = useCallback((dx: number, dy: number) => {
    if (!selectedHotspot) return
    if (selectedHotspot.kind === 'room') {
      setRoomLayoutState((current) => current.map((room) =>
        room.id !== selectedHotspot.id ? room : { ...room, x: clamp(room.x + dx, 2, 94 - room.w), y: clamp(room.y + dy, 8, 94 - room.h) }
      ))
      setSelectedHotspot((current) => current ? { ...current, x: clamp(current.x + dx, 2, 98), y: clamp(current.y + dy, 8, 98) } : current)
      return
    }
    setMapPropsState((current) => current.map((prop) =>
      prop.id !== selectedHotspot.id ? prop : { ...prop, x: clamp(prop.x + dx, 2, 98 - prop.w), y: clamp(prop.y + dy, 8, 98 - prop.h) }
    ))
    setSelectedHotspot((current) => current ? { ...current, x: clamp(current.x + dx, 2, 98), y: clamp(current.y + dy, 8, 98) } : current)
  }, [selectedHotspot])

  const resizeSelectedRoom = useCallback((dw: number, dh: number) => {
    if (!selectedHotspot || selectedHotspot.kind !== 'room') return
    setRoomLayoutState((current) => current.map((room) => {
      if (room.id !== selectedHotspot.id) return room
      const nextW = clamp(room.w + dw, 10, 40)
      const nextH = clamp(room.h + dh, 10, 36)
      return { ...room, w: nextW, h: nextH, x: clamp(room.x, 2, 98 - nextW), y: clamp(room.y, 8, 98 - nextH) }
    }))
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

  const showLaunchToast = (toast: LaunchToast) => {
    setLaunchToast(toast)
    if (launchToastTimerRef.current) clearTimeout(launchToastTimerRef.current)
    launchToastTimerRef.current = setTimeout(() => { setLaunchToast(null); launchToastTimerRef.current = null }, 5000)
  }

  const openFlightDeck = async (agent: Agent) => {
    setFlightDeckLaunching(true)
    try {
      const res = await fetch('/api/local/flight-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, session: agent.session_key || '' }),
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.installed === false) {
        if (typeof json?.downloadUrl === 'string' && json.downloadUrl) setFlightDeckDownloadUrl(json.downloadUrl)
        setShowFlightDeckModal(true)
        showLaunchToast({ kind: 'info', title: 'Flight Deck not installed', detail: 'Install Flight Deck to open this session.' })
        return
      }
      if (!json?.launched) {
        if (typeof json?.fallbackUrl === 'string' && json.fallbackUrl) {
          window.open(json.fallbackUrl, '_blank', 'noopener,noreferrer')
          showLaunchToast({ kind: 'info', title: 'Opened browser fallback', detail: 'Native launch failed, opened Flight Deck web fallback.' })
          return
        }
        showLaunchToast({ kind: 'error', title: 'Flight Deck launch failed', detail: json?.error || 'Unable to launch Flight Deck for this session.' })
        return
      }
      showLaunchToast({ kind: 'success', title: 'Opened in Flight Deck', detail: 'Launched native Flight Deck app for this session.' })
    } catch {
      setShowFlightDeckModal(true)
      showLaunchToast({ kind: 'error', title: 'Flight Deck request failed', detail: 'Could not reach local launch endpoint.' })
    } finally {
      setFlightDeckLaunching(false)
    }
  }

  const resetMapView = () => { setMapZoom(1); setMapPan({ x: 0, y: 0 }) }
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
    setMapPan({ x: mapPanStartRef.current.x + dx, y: mapPanStartRef.current.y + dy })
  }
  const endMapDrag = () => { mapDragActiveRef.current = false }

  // ── Idle roaming ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLocalMode) return
    const interval = setInterval(() => {
      const activeMovingIds = movingAgentIdsRef.current
      const idleCandidates = renderedWorkersRef.current
        .filter((w) => w.agent.status === 'idle' && !w.isMoving && !activeMovingIds.has(w.agent.id))
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
          if (seat) enqueueMovement(worker.agent, waypoint.x, waypoint.y, seat.x, seat.y, 2200)
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
      pushOfficeEvent({ kind: 'room', severity: mood, message: `${sample.zoneLabel}: ${sample.agent.name} status is ${statusLabel[sample.agent.status].toLowerCase()}.` })
    }, 22000)
    return () => clearInterval(interval)
  }, [pushOfficeEvent])

  // ── Early returns ─────────────────────────────────────────────────────────
  if ((loading || (isLocalMode && localBootstrapping)) && visibleDisplayAgents.length === 0) {
    return <Loader variant="panel" label={isLocalMode ? 'Scanning local sessions...' : 'Loading office...'} />
  }

  // ── Slot composition ──────────────────────────────────────────────────────
  const minimapSlot = showMinimap ? (
    <OfficeMinimap
      roomLayoutState={roomLayoutState}
      renderedWorkers={renderedWorkers}
      focusMapPoint={focusMapPoint}
      setSelectedAgent={setSelectedAgent}
    />
  ) : null

  const deckLogSlot = showEvents ? (
    <OfficeDeckLog
      officeEvents={officeEvents}
      selectedHotspot={selectedHotspot}
      nudgeSelectedHotspot={nudgeSelectedHotspot}
      resizeSelectedRoom={resizeSelectedRoom}
    />
  ) : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => { setError(null); fetchAgents() }} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">Retry</button>
        </div>
      )}

      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Command Deck</h1>
            <p className="text-muted-foreground mt-1">Monitor your crew in real time</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground mr-4">
              {counts.busy > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-amber" />{counts.busy} active</span>}
              {counts.idle > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-mint" />{counts.idle} standby</span>}
              {counts.error > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-void-crimson" />{counts.error} alert</span>}
              {counts.offline > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40" />{counts.offline} offline</span>}
            </div>
            <div className="flex rounded-md overflow-hidden border border-border">
              <Button variant={viewMode === 'office' ? 'default' : 'secondary'} size="sm" onClick={() => setViewMode('office')} className="rounded-none">Deck</Button>
              <Button variant={viewMode === 'org-chart' ? 'default' : 'secondary'} size="sm" onClick={() => setViewMode('org-chart')} className="rounded-none">Crew Chart</Button>
            </div>
            <Button variant="secondary" size="sm" onClick={fetchAgents}>Refresh</Button>
          </div>
        </div>
      </div>

      {visibleDisplayAgents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 mx-auto mb-3 text-void-cyan/30">
            <path d="M8 1l6 4v6l-6 4-6-4V5l6-4z" />
            <path d="M8 1v14M2 5l6 4 6-4" />
          </svg>
          <p className="text-lg">The deck is empty</p>
          <p className="text-sm mt-1">Deploy agents to see them appear here</p>
        </div>
      ) : viewMode === 'office' ? (
        <div className={`grid grid-cols-1 ${showSidebar ? 'xl:grid-cols-[220px_1fr]' : 'xl:grid-cols-1'} gap-4`}>
          {showSidebar && (
            <OfficeSidebar
              filteredRosterRows={filteredRosterRows}
              sidebarFilter={sidebarFilter}
              setSidebarFilter={setSidebarFilter}
              isLocalMode={isLocalMode}
              localSessionFilter={localSessionFilter}
              setLocalSessionFilter={setLocalSessionFilter}
              visibleDisplayAgents={visibleDisplayAgents}
              renderedWorkers={renderedWorkers}
              focusMapPoint={focusMapPoint}
              setSelectedAgent={setSelectedAgent}
            />
          )}
          <OfficeMapCanvas
            mapViewportRef={mapViewportRef}
            themePalette={themePalette}
            timeTheme={timeTheme}
            setTimeTheme={setTimeTheme}
            mapZoom={mapZoom}
            setMapZoom={setMapZoom}
            mapPan={mapPan}
            onMapWheel={onMapWheel}
            onMapMouseDown={onMapMouseDown}
            onMapMouseMove={onMapMouseMove}
            endMapDrag={endMapDrag}
            showSidebar={showSidebar}
            setShowSidebar={setShowSidebar}
            showMinimap={showMinimap}
            setShowMinimap={setShowMinimap}
            showEvents={showEvents}
            setShowEvents={setShowEvents}
            resetOfficeLayout={resetOfficeLayout}
            resetMapView={resetMapView}
            floorTiles={floorTiles}
            heatmapPoints={heatmapPoints}
            roomLayoutState={roomLayoutState}
            mapPropsState={mapPropsState}
            pathEdges={pathEdges}
            renderedWorkers={renderedWorkers}
            nightSparkles={nightSparkles}
            spriteFrame={spriteFrame}
            transitioningAgentIds={transitioningAgentIds}
            agentActionOverrides={agentActionOverrides}
            setSelectedAgent={setSelectedAgent}
            setSelectedHotspot={setSelectedHotspot}
            pushOfficeEvent={pushOfficeEvent}
            minimapSlot={minimapSlot}
            deckLogSlot={deckLogSlot}
          />
        </div>
      ) : (
        <OrgChart
          orgSegmentMode={orgSegmentMode}
          setOrgSegmentMode={setOrgSegmentMode}
          orgGroups={orgGroups}
          setSelectedAgent={setSelectedAgent}
        />
      )}

      {selectedAgent && (
        <AgentModal
          selectedAgent={selectedAgent}
          isLocalMode={isLocalMode}
          flightDeckLaunching={flightDeckLaunching}
          onClose={() => setSelectedAgent(null)}
          executeAgentAction={executeAgentAction}
          openFlightDeck={openFlightDeck}
        />
      )}

      {showFlightDeckModal && (
        <FlightDeckModal
          flightDeckDownloadUrl={flightDeckDownloadUrl}
          onClose={() => setShowFlightDeckModal(false)}
        />
      )}

      {launchToast && <OfficeLaunchToast launchToast={launchToast} />}

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
