'use client'

// Main map viewport — floor tiles, zone rooms, props, worker sprites, atmospheric overlays,
// and the toolbar buttons for zoom/theme/toggle controls.
// Children (minimap, deck log) are rendered as overlay slots passed in via props.

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import type { Agent } from '@/store'
import type {
  MapRoom,
  MapProp,
  ThemePalette,
  TimeTheme,
  OfficeHotspot,
  OfficeEvent,
  RenderedWorker,
  WorkerVariant,
} from './office-types'
import {
  statusDot,
  hashColor,
  getStatusEmote,
  getPropSprite,
  getWorkerHeroFrame,
  HERO_SHEET_COLS,
  HERO_SHEET_ROWS,
} from './office-utils'

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

      {/* Toolbar: label */}
      <div className="absolute left-[8%] top-[8%] rounded-md bg-card/80 backdrop-blur-sm border border-void-cyan/20 text-void-cyan text-xs px-2 py-1 font-mono z-30">
        MAIN DECK
      </div>

      {/* Toolbar: zoom controls */}
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
        <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">-</Button>
        <span className="text-[11px] font-mono w-10 text-center">{Math.round(mapZoom * 100)}%</span>
        <Button variant="ghost" size="xs" onClick={() => setMapZoom((z) => Math.min(2.2, Number((z + 0.1).toFixed(2))))} className="h-auto px-1.5 py-0.5 text-xs hover:bg-void-cyan/10">+</Button>
        <Button variant="ghost" size="xs" onClick={resetMapView} className="h-auto px-1.5 py-0.5 text-[11px] hover:bg-void-cyan/10">Reset</Button>
      </div>

      {/* Toolbar: time-theme selector */}
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

      {/* Toolbar: panel toggles */}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-md bg-card/80 backdrop-blur-sm border border-border text-foreground/90 px-2 py-1">
        <Button variant="ghost" size="xs" onClick={() => setShowSidebar((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showSidebar ? 'Hide Crew' : 'Show Crew'}</Button>
        <Button variant="ghost" size="xs" onClick={() => setShowMinimap((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showMinimap ? 'Hide Radar' : 'Show Radar'}</Button>
        <Button variant="ghost" size="xs" onClick={() => setShowEvents((v) => !v)} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">{showEvents ? 'Hide Log' : 'Show Log'}</Button>
        <Button variant="ghost" size="xs" onClick={resetOfficeLayout} className="h-auto px-1.5 py-0.5 text-[10px] font-mono hover:bg-void-cyan/10">Reset Layout</Button>
      </div>

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

// ─── Worker sprite sub-component ─────────────────────────────────────────────

interface WorkerSpriteProps {
  agent: Agent
  x: number
  y: number
  zoneLabel: string
  seatLabel: string
  isMoving: boolean
  direction: { dx: number; dy: number }
  spriteFrame: number
  transitioningAgentIds: Set<number>
  agentActionOverrides: Map<number, string>
  themePalette: ThemePalette
  setSelectedAgent: (agent: Agent | null) => void
}

function WorkerSprite({
  agent,
  x,
  y,
  zoneLabel,
  seatLabel,
  isMoving,
  direction,
  spriteFrame,
  transitioningAgentIds,
  agentActionOverrides,
  themePalette,
  setSelectedAgent,
}: WorkerSpriteProps): React.ReactElement {
  const isTransitioning = transitioningAgentIds.has(agent.id)
  const frame = getWorkerHeroFrame(agent.status, isMoving, spriteFrame)
  const xPct = (frame.col / (HERO_SHEET_COLS - 1)) * 100
  const yPct = (frame.row / (HERO_SHEET_ROWS - 1)) * 100
  const flipX = isMoving && Math.abs(direction.dx) > Math.abs(direction.dy) && direction.dx < 0

  return (
    <div key={agent.id}>
      {/* Chair */}
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

      {/* Desk + monitor */}
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

      {/* Clickable agent sprite */}
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
            className={`absolute inset-0 ${isTransitioning || isMoving ? 'animate-pulse' : ''}`}
            style={{
              backgroundImage: `url('/office-sprites/cc0-hero/player_full_animation.png')`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${HERO_SHEET_COLS * 100}% ${HERO_SHEET_ROWS * 100}%`,
              backgroundPosition: `${xPct}% ${yPct}%`,
              imageRendering: 'pixelated',
              filter: themePalette.spriteFilter,
              transform: flipX ? 'scaleX(-1)' : undefined,
              transformOrigin: 'center',
            }}
          />
          <div className={`absolute left-[8px] top-[14px] w-4 h-3 ${hashColor(agent.name)} border border-black/60`} />
        </div>
        {!isMoving && <div className="text-[9px] text-slate-300 font-mono mt-0.5">#{seatLabel}</div>}
      </Button>

      {/* Action override label */}
      {agentActionOverrides.has(agent.id) && (
        <div
          className="absolute -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-cyan-200"
          style={{ left: `${x}%`, top: `calc(${y}% - 24px)` }}
        >
          {agentActionOverrides.get(agent.id)}
        </div>
      )}

      {/* Moving badge */}
      {(isTransitioning || isMoving) && (
        <div
          className="absolute -translate-x-1/2 text-[9px] text-slate-200/85 font-medium px-1.5 py-0.5 rounded bg-black/45 border border-white/10"
          style={{ left: `${x}%`, top: `calc(${y}% + 22px)` }}
        >
          moving
        </div>
      )}

      {/* Zone label */}
      <div
        className="absolute text-[9px] text-slate-500/70 font-mono pointer-events-none"
        style={{ left: `${x}%`, top: `calc(${y}% + 38px)` }}
      >
        {zoneLabel}
      </div>
    </div>
  )
}
