'use client'

import type { MouseEvent, WheelEvent } from 'react'
import Image from 'next/image'
import type { Agent } from '@/store'
import type {
  ThemePalette,
  TimeTheme,
  MapRoom,
  MapProp,
  RenderedWorker,
  OfficeEvent,
  OfficeHotspot,
} from './types'
import {
  hashColor,
  hashNumber,
  getStatusEmote,
  statusDot,
  statusLabel,
  formatLastSeen,
  getPropSprite,
  getWorkerHeroFrame,
  HERO_SHEET_COLS,
  HERO_SHEET_ROWS,
} from './types'

interface OfficeFloorMapProps {
  mapViewportRef: React.RefObject<HTMLDivElement | null>
  themePalette: ThemePalette
  timeTheme: TimeTheme
  nightSparkles: Array<{ id: number; x: number; y: number; delay: number; size: number }>
  mapZoom: number
  setMapZoom: React.Dispatch<React.SetStateAction<number>>
  mapPan: { x: number; y: number }
  setMapPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  showSidebar: boolean
  setShowSidebar: React.Dispatch<React.SetStateAction<boolean>>
  showMinimap: boolean
  setShowMinimap: React.Dispatch<React.SetStateAction<boolean>>
  showEvents: boolean
  setShowEvents: React.Dispatch<React.SetStateAction<boolean>>
  roomLayoutState: MapRoom[]
  mapPropsState: MapProp[]
  floorTiles: Array<{ id: string; x: number; y: number; w: number; h: number; sprite: boolean }>
  heatmapPoints: Array<{ id: number; x: number; y: number; radius: number; color: string }>
  pathEdges: Array<{ x1: number; y1: number; x2: number; y2: number }>
  renderedWorkers: RenderedWorker[]
  transitioningAgentIds: Set<number>
  agentActionOverrides: Map<number, string>
  spriteFrame: number
  officeEvents: OfficeEvent[]
  selectedHotspot: OfficeHotspot | null
  setSelectedHotspot: React.Dispatch<React.SetStateAction<OfficeHotspot | null>>
  setSelectedAgent: (agent: Agent | null) => void
  setTimeTheme: (theme: TimeTheme) => void
  resetMapView: () => void
  resetOfficeLayout: () => void
  pushOfficeEvent: (event: Omit<OfficeEvent, 'id' | 'at'>) => void
  focusMapPoint: (x: number, y: number) => void
  nudgeSelectedHotspot: (dx: number, dy: number) => void
  resizeSelectedRoom: (dw: number, dh: number) => void
  onMapWheel: (event: WheelEvent<HTMLDivElement>) => void
  onMapMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  onMapMouseMove: (event: MouseEvent<HTMLDivElement>) => void
  endMapDrag: () => void
}

export function OfficeFloorMap({
  mapViewportRef,
  themePalette,
  timeTheme,
  nightSparkles,
  mapZoom,
  setMapZoom,
  mapPan,
  showSidebar,
  setShowSidebar,
  showMinimap,
  setShowMinimap,
  showEvents,
  setShowEvents,
  roomLayoutState,
  mapPropsState,
  floorTiles,
  heatmapPoints,
  pathEdges,
  renderedWorkers,
  transitioningAgentIds,
  agentActionOverrides,
  spriteFrame,
  officeEvents,
  selectedHotspot,
  setSelectedHotspot,
  setSelectedAgent,
  setTimeTheme,
  resetMapView,
  resetOfficeLayout,
  pushOfficeEvent,
  focusMapPoint,
  nudgeSelectedHotspot,
  resizeSelectedRoom,
  onMapWheel,
  onMapMouseDown,
  onMapMouseMove,
  endMapDrag,
}: OfficeFloorMapProps) {
  return (
    <div
      ref={mapViewportRef}
      className="relative rounded-xl border border-slate-700/70 overflow-hidden min-h-[560px] cursor-grab active:cursor-grabbing shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
      style={{
        backgroundColor: '#0b1220',
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

      <div className="absolute left-[8%] top-[8%] rounded-md bg-black/55 border border-white/10 text-slate-100 text-xs px-2 py-1 font-mono z-30">
        MAIN FLOOR
      </div>
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md bg-black/50 border border-white/10 text-white/90 px-2 py-1">
        <button onClick={() => setMapZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))))} className="text-xs px-1.5 py-0.5 hover:bg-white/10 rounded">-</button>
        <span className="text-[11px] w-10 text-center">{Math.round(mapZoom * 100)}%</span>
        <button onClick={() => setMapZoom((z) => Math.min(2.2, Number((z + 0.1).toFixed(2))))} className="text-xs px-1.5 py-0.5 hover:bg-white/10 rounded">+</button>
        <button onClick={resetMapView} className="text-[11px] px-1.5 py-0.5 hover:bg-white/10 rounded">Reset</button>
      </div>
      <div className="absolute right-3 top-12 z-30 flex items-center gap-1 rounded-md bg-black/50 border border-white/10 text-white/90 px-2 py-1">
        {(['dawn', 'day', 'dusk', 'night'] as TimeTheme[]).map((item) => (
          <button
            key={item}
            onClick={() => setTimeTheme(item)}
            className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${timeTheme === item ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-slate-300'}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-md bg-black/50 border border-white/10 text-white/90 px-2 py-1">
        <button onClick={() => setShowSidebar((v) => !v)} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10">{showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}</button>
        <button onClick={() => setShowMinimap((v) => !v)} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10">{showMinimap ? 'Hide Minimap' : 'Show Minimap'}</button>
        <button onClick={() => setShowEvents((v) => !v)} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10">{showEvents ? 'Hide Events' : 'Show Events'}</button>
        <button onClick={resetOfficeLayout} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10">Reset Layout</button>
      </div>

      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})` }}
      >
        <div className="absolute inset-0 z-0">
          {floorTiles.map((tile) => (
            <div
              key={tile.id}
              className="absolute border border-[#7fa4ff]/[0.06]"
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
        <div className="absolute left-[14%] top-[45%] w-[72%] h-[6%] border-y border-[#95b8ff]/25 shadow-[0_0_30px_rgba(61,139,255,0.25)]" style={{ backgroundColor: themePalette.corridor }} />
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
            className={`absolute border border-[#8ea6d9]/35 ${room.style} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.3)]`}
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
            <div className="absolute left-2 top-1 rounded bg-black/55 border border-white/10 text-white text-[9px] px-1.5 py-0.5 font-mono uppercase tracking-wide">
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

            <button
              onClick={() => setSelectedAgent(agent)}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 hover:scale-110"
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
            </button>

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
                moving
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
        className="absolute right-3 bottom-3 z-30 w-44 h-28 rounded-md border border-white/15 bg-[#0b1220]/85 backdrop-blur-sm p-1.5"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          const target = event.currentTarget
          const rect = target.getBoundingClientRect()
          const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
          const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
          focusMapPoint(x, y)
        }}
      >
        <div className="text-[9px] text-slate-300 uppercase tracking-wider mb-1">Minimap</div>
        <div className="relative w-full h-[calc(100%-16px)] rounded-sm overflow-hidden border border-white/10 bg-[#111a2f]">
          {roomLayoutState.map((room) => (
            <div
              key={`mini-${room.id}`}
              className="absolute border border-white/15 bg-white/10"
              style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%` }}
            />
          ))}
          <div className="absolute left-[14%] top-[47%] w-[72%] h-[4%] bg-[#6f80a7]" />
          {renderedWorkers.map((worker) => (
            <button
              key={`mini-worker-${worker.agent.id}`}
              className={`absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ${hashColor(worker.agent.name)} border border-black/40`}
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
        className="absolute left-3 bottom-3 z-30 w-72 rounded-md border border-white/15 bg-[#0b1220]/88 backdrop-blur-sm p-2.5 space-y-2"
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="text-[10px] text-slate-300 uppercase tracking-wider">Office Events</div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300" />Busy Heat</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-300" />Idle Heat</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-300" />Other</span>
        </div>
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1" onWheel={(event) => event.stopPropagation()}>
          {officeEvents.length === 0 && (
            <div className="text-[11px] text-slate-500">No events yet. Click a room/desk or run an action.</div>
          )}
          {officeEvents.map((event) => (
            <div key={event.id} className="text-[11px] rounded px-2 py-1 bg-black/35 border border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`uppercase text-[9px] ${
                    event.severity === 'good'
                      ? 'text-emerald-300'
                      : event.severity === 'warn'
                        ? 'text-amber-300'
                        : 'text-sky-300'
                  }`}
                >
                  {event.kind}
                </span>
                <span className="text-slate-500 text-[9px]">{formatLastSeen(Math.floor(event.at / 1000))}</span>
              </div>
              <div className="text-slate-200">{event.message}</div>
            </div>
          ))}
        </div>
        {selectedHotspot && (
          <div className="rounded border border-white/10 bg-black/35 p-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-white">{selectedHotspot.label}</div>
              <div className="text-[9px] uppercase text-slate-400">{selectedHotspot.kind}</div>
            </div>
            <div className="mt-1.5 space-y-1">
              {selectedHotspot.stats.map((line) => (
                <div key={line} className="text-[10px] text-slate-300">{line}</div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button onClick={() => nudgeSelectedHotspot(0, -1)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Up</button>
              <button onClick={() => nudgeSelectedHotspot(-1, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Left</button>
              <button onClick={() => nudgeSelectedHotspot(1, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Right</button>
              <button onClick={() => nudgeSelectedHotspot(0, 1)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Down</button>
              <button onClick={() => nudgeSelectedHotspot(-0.5, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Fine -X</button>
              <button onClick={() => nudgeSelectedHotspot(0.5, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Fine +X</button>
            </div>
            {selectedHotspot.kind === 'room' && (
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button onClick={() => resizeSelectedRoom(1, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Wider</button>
                <button onClick={() => resizeSelectedRoom(-1, 0)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Narrower</button>
                <button onClick={() => resizeSelectedRoom(0, 1)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Taller</button>
                <button onClick={() => resizeSelectedRoom(0, -1)} className="text-[10px] rounded border border-white/10 py-1 hover:bg-white/10">Shorter</button>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
