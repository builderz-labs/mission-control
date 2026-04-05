'use client'

// Thin shell — state orchestration only.
// Data fetching → useOfficeAgents
// Animations    → useOfficeAnimations
// Rendering     → focused sub-components in ./office/

import { useState, useCallback, useRef } from 'react'
import type { MouseEvent, WheelEvent } from 'react'
import { Loader } from '@/components/ui/loader'
import { useMissionControl, Agent } from '@/store'
import {
  // Types
  ViewMode,
  OrgSegmentMode,
  OfficeAction,
  MapRoom,
  MapProp,
  LaunchToast,
  OfficeHotspot,
  OfficeEvent,
  MovingWorker,
  // Constants
  ROOM_LAYOUT,
  MAP_PROPS,
  LOUNGE_WAYPOINTS,
  // Utils
  hashNumber,
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
  OfficeHeader,
  OfficeEmptyState,
  OfficeMapStyles,
  // Hooks
  useThemePalette,
  useOfficeSeatMap,
  useOrgGroups,
  useOfficePrefs,
  useOfficeAgents,
  useOfficeAnimations,
} from './office'

export function OfficePanel(): React.ReactElement {
  const { agents, dashboardMode, currentUser } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('office')
  const [orgSegmentMode, setOrgSegmentMode] = useState<OrgSegmentMode>('category')
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'working' | 'idle' | 'attention'>('all')

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
  const [roomLayoutState, setRoomLayoutState] = useState<MapRoom[]>(() => ROOM_LAYOUT.map((r) => ({ ...r })))
  const [mapPropsState, setMapPropsState] = useState<MapProp[]>(() => MAP_PROPS.map((p) => ({ ...p })))
  const [mapZoom, setMapZoom] = useState(1)
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 })

  // movingWorkers lives in shell so both useOfficeSeatMap and useOfficeAnimations share it
  const [movingWorkers, setMovingWorkers] = useState<MovingWorker[]>([])

  // ── Refs (map drag + toast timer) ─────────────────────────────────────────
  const mapViewportRef = useRef<HTMLDivElement | null>(null)
  const mapDragActiveRef = useRef(false)
  const mapDragOriginRef = useRef({ x: 0, y: 0 })
  const mapPanStartRef = useRef({ x: 0, y: 0 })
  const launchToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Data hook ─────────────────────────────────────────────────────────────
  const {
    loading, localBootstrapping, error, setError, fetchAgents,
    visibleDisplayAgents, displayAgents, counts, localSessionFilter, setLocalSessionFilter,
  } = useOfficeAgents({ isLocalMode, storeAgents: agents })

  // ── Theme hook ────────────────────────────────────────────────────────────
  const { timeTheme, setTimeTheme, themePalette } = useThemePalette()

  // ── Seat map hook (depends on movingWorkers from shell state) ─────────────
  const {
    currentSeatMap, renderedWorkers, floorTiles, nightSparkles,
    heatmapPoints, pathEdges, filteredRosterRows,
  } = useOfficeSeatMap({ visibleDisplayAgents, movingWorkers, agentActionOverrides, sidebarFilter, isLocalMode })

  // ── Event push callback (shared between shells and animation hook) ─────────
  const pushOfficeEvent = useCallback((event: Omit<OfficeEvent, 'id' | 'at'>): void => {
    const next: OfficeEvent = { ...event, id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, at: Date.now() }
    setOfficeEvents((current) => [next, ...current].slice(0, 12))
  }, [])

  // ── Animation hook (reads currentSeatMap, writes movingWorkers via setter) ─
  const { spriteFrame, transitioningAgentIds, enqueueMovement } = useOfficeAnimations({
    displayAgents,
    currentSeatMap,
    renderedWorkers,
    pushOfficeEvent,
    isLocalMode,
    movingWorkers,
    setMovingWorkers,
  })

  // ── Org chart hook ────────────────────────────────────────────────────────
  const { orgGroups } = useOrgGroups(visibleDisplayAgents, orgSegmentMode)

  // ── Preferences hook ──────────────────────────────────────────────────────
  useOfficePrefs({
    currentUserId: currentUser?.id,
    currentUserName: currentUser?.username,
    dashboardMode,
    state: { viewMode, sidebarFilter, localSessionFilter, mapZoom, mapPan, timeTheme, showSidebar, showMinimap, showEvents, roomLayoutState, mapPropsState },
    setters: { setViewMode, setSidebarFilter, setLocalSessionFilter, setMapZoom, setMapPan, setTimeTheme, setShowSidebar, setShowMinimap, setShowEvents, setRoomLayoutState, setMapPropsState },
  })

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const executeAgentAction = useCallback((agent: Agent, action: OfficeAction): void => {
    setAgentActionOverrides((current) => { const next = new Map(current); next.set(agent.id, action); return next })
    if (action === 'focus') {
      pushOfficeEvent({ kind: 'action', severity: 'good', message: `${agent.name} is now in deep focus mode.` })
      return
    }
    if (action === 'pair') {
      const partner = renderedWorkers.find((w) => w.agent.id !== agent.id)?.agent
      pushOfficeEvent({
        kind: 'action', severity: 'info',
        message: partner ? `${agent.name} started a pairing session with ${partner.name}.` : `${agent.name} started a solo pairing prep session.`,
      })
      return
    }
    const worker = renderedWorkers.find((item) => item.agent.id === agent.id)
    const waypoint = LOUNGE_WAYPOINTS[hashNumber(agent.name) % LOUNGE_WAYPOINTS.length]
    if (worker) {
      enqueueMovement(agent, worker.x, worker.y, waypoint.x, waypoint.y, 2200)
      pushOfficeEvent({ kind: 'action', severity: 'warn', message: `${agent.name} is taking a short lounge break.` })
      return
    }
    pushOfficeEvent({ kind: 'action', severity: 'warn', message: `${agent.name} requested a break.` })
  }, [enqueueMovement, pushOfficeEvent, renderedWorkers])

  const focusMapPoint = useCallback((xPercent: number, yPercent: number): void => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    setMapPan({ x: rect.width / 2 - (xPercent / 100) * rect.width * mapZoom, y: rect.height / 2 - (yPercent / 100) * rect.height * mapZoom })
  }, [mapZoom])

  const nudgeSelectedHotspot = useCallback((dx: number, dy: number): void => {
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

  const resizeSelectedRoom = useCallback((dw: number, dh: number): void => {
    if (!selectedHotspot || selectedHotspot.kind !== 'room') return
    setRoomLayoutState((current) => current.map((room) => {
      if (room.id !== selectedHotspot.id) return room
      const nextW = clamp(room.w + dw, 10, 40)
      const nextH = clamp(room.h + dh, 10, 36)
      return { ...room, w: nextW, h: nextH, x: clamp(room.x, 2, 98 - nextW), y: clamp(room.y, 8, 98 - nextH) }
    }))
  }, [selectedHotspot])

  const resetOfficeLayout = useCallback((): void => {
    setRoomLayoutState(ROOM_LAYOUT.map((r) => ({ ...r })))
    setMapPropsState(MAP_PROPS.map((p) => ({ ...p })))
    setMapZoom(1); setMapPan({ x: 0, y: 0 })
    setShowSidebar(true); setShowMinimap(true); setShowEvents(true)
    setSelectedHotspot(null)
    pushOfficeEvent({ kind: 'room', severity: 'info', message: 'Office layout reset to defaults.' })
  }, [pushOfficeEvent])

  const showLaunchToast = useCallback((toast: LaunchToast): void => {
    setLaunchToast(toast)
    if (launchToastTimerRef.current) clearTimeout(launchToastTimerRef.current)
    launchToastTimerRef.current = setTimeout(() => { setLaunchToast(null); launchToastTimerRef.current = null }, 5000)
  }, [])

  const openFlightDeck = useCallback(async (agent: Agent): Promise<void> => {
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
  }, [showLaunchToast])

  const resetMapView = (): void => { setMapZoom(1); setMapPan({ x: 0, y: 0 }) }
  const onMapWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.08 : 0.08
    setMapZoom((current) => Math.min(2.2, Math.max(0.8, Number((current + delta).toFixed(2)))))
  }
  const onMapMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    mapDragActiveRef.current = true
    mapDragOriginRef.current = { x: event.clientX, y: event.clientY }
    mapPanStartRef.current = { ...mapPan }
  }
  const onMapMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (!mapDragActiveRef.current) return
    setMapPan({ x: mapPanStartRef.current.x + event.clientX - mapDragOriginRef.current.x, y: mapPanStartRef.current.y + event.clientY - mapDragOriginRef.current.y })
  }
  const endMapDrag = (): void => { mapDragActiveRef.current = false }

  // ── Early return ──────────────────────────────────────────────────────────
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
          <button onClick={() => { setError(null); void fetchAgents() }} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">Retry</button>
        </div>
      )}

      <OfficeHeader counts={counts} viewMode={viewMode} setViewMode={setViewMode} onRefresh={() => void fetchAgents()} />

      {visibleDisplayAgents.length === 0 ? (
        <OfficeEmptyState />
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

      <OfficeMapStyles />
    </div>
  )
}
