'use client'

// Main map viewport — floor tiles, zone rooms, props, worker sprites, atmospheric overlays,
// and the toolbar buttons for zoom/theme/toggle controls.
// Children (minimap, deck log) are rendered as overlay slots passed in via props.

import Image from 'next/image'
import type { Agent } from '@/store'
import type {
  MapRoom,
  MapProp,
  ThemePalette,
  TimeTheme,
  OfficeHotspot,
  OfficeEvent,
  RenderedWorker,
} from './office-types'
import { getPropSprite } from './office-utils'
import { WorkerSprite } from './worker-sprite'
import { OfficeToolbar } from './office-toolbar'

interface FloorTile {
  id: string
  x: number
  y: number
  w: number
  h: number
  sprite: boolean
}

interface HeatmapPoint {
  id: number
  x: number
  y: number
  radius: number
  color: string
}

interface PathEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface NightSparkle {
  id: number
  x: number
  y: number
  delay: number
  size: number
}

interface OfficeMapCanvasProps {
  mapViewportRef: React.RefObject<HTMLDivElement | null>
  themePalette: ThemePalette
  timeTheme: TimeTheme
  setTimeTheme: (theme: TimeTheme) => void
  mapZoom: number
  setMapZoom: React.Dispatch<React.SetStateAction<number>>
  mapPan: { x: number; y: number }
  onMapWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  onMapMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  onMapMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void
  endMapDrag: () => void
  showSidebar: boolean
  setShowSidebar: React.Dispatch<React.SetStateAction<boolean>>
  showMinimap: boolean
  setShowMinimap: React.Dispatch<React.SetStateAction<boolean>>
  showEvents: boolean
  setShowEvents: React.Dispatch<React.SetStateAction<boolean>>
  resetOfficeLayout: () => void
  resetMapView: () => void
  floorTiles: FloorTile[]
  heatmapPoints: HeatmapPoint[]
  roomLayoutState: MapRoom[]
  mapPropsState: MapProp[]
  pathEdges: PathEdge[]
  renderedWorkers: RenderedWorker[]
  nightSparkles: NightSparkle[]
  spriteFrame: number
  transitioningAgentIds: Set<number>
  agentActionOverrides: Map<number, string>
  setSelectedAgent: (agent: Agent | null) => void
  setSelectedHotspot: (hotspot: OfficeHotspot | null) => void
  pushOfficeEvent: (event: Omit<OfficeEvent, 'id' | 'at'>) => void
  // Overlay children — minimap and deck log
  minimapSlot?: React.ReactNode
  deckLogSlot?: React.ReactNode
}

export function OfficeMapCanvas({
  mapViewportRef,
  themePalette,
  timeTheme,
  setTimeTheme,
  mapZoom,
  setMapZoom,
  mapPan,
  onMapWheel,
  onMapMouseDown,
  onMapMouseMove,
  endMapDrag,
  showSidebar,
  setShowSidebar,
  showMinimap,
  setShowMinimap,
  showEvents,
  setShowEvents,
  resetOfficeLayout,
  resetMapView,
  floorTiles,
  heatmapPoints,
  roomLayoutState,
  mapPropsState,
  pathEdges,
  renderedWorkers,
  nightSparkles,
  spriteFrame,
  transitioningAgentIds,
  agentActionOverrides,
  setSelectedAgent,
  setSelectedHotspot,
  pushOfficeEvent,
  minimapSlot,
  deckLogSlot,
}: OfficeMapCanvasProps): React.ReactElement {
  return (
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
      {/* Atmospheric layers */}
      <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.haze }} />
      <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.glow }} />
      <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.atmosphere, mixBlendMode: 'screen', opacity: 0.9 }} />
      <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: themePalette.shadowVeil }} />

      {/* Time-theme overlays */}
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

      <OfficeToolbar
        mapZoom={mapZoom}
        setMapZoom={setMapZoom}
        timeTheme={timeTheme}
        setTimeTheme={setTimeTheme}
        showSidebar={showSidebar}
        setShowSidebar={setShowSidebar}
        showMinimap={showMinimap}
        setShowMinimap={setShowMinimap}
        showEvents={showEvents}
        setShowEvents={setShowEvents}
        resetOfficeLayout={resetOfficeLayout}
        resetMapView={resetMapView}
      />

      {/* Panned/scaled world */}
      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})` }}
      >
        {/* Floor tiles */}
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

        {/* Heatmap */}
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

        {/* Path edges SVG */}
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

        {/* Worker sprites */}
        {renderedWorkers.map(({ agent, x, y, zoneLabel, seatLabel, isMoving, direction }: RenderedWorker) => (
          <WorkerSprite
            key={agent.id}
            agent={agent}
            x={x}
            y={y}
            zoneLabel={zoneLabel}
            seatLabel={seatLabel}
            isMoving={isMoving}
            direction={direction}
            spriteFrame={spriteFrame}
            transitioningAgentIds={transitioningAgentIds}
            agentActionOverrides={agentActionOverrides}
            themePalette={themePalette}
            setSelectedAgent={setSelectedAgent}
          />
        ))}
      </div>

      {/* Overlay slots — rendered above the panned world */}
      {minimapSlot}
      {deckLogSlot}
    </div>
  )
}
