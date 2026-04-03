// Derives all seat-map geometry and roster data from the office layout.
// Extracted from the shell so the seat-coordinate math stays separate from event handling.

import { useMemo } from 'react'
import type { Agent } from '@/store'
import { buildOfficeLayout } from '@/lib/office-layout'
import type {
  SeatPosition,
  MovingWorker,
  RenderedWorker,
  OfficeAction,
  SidebarFilter,
  FloorTile,
  HeatmapPoint,
  PathEdge,
  NightSparkle,
  RosterRow,
} from './office-types'
import {
  MAP_COLS,
  MAP_ROWS,
  pointAlongPath,
} from './office-map-constants'
import {
  hashNumber,
  clamp,
  getWorkerVariant,
  easeInOut,
} from './office-utils'

// ─── Seat template constants (local to this module) ───────────────────────────

const ZONE_SEAT_TEMPLATES: Record<string, Array<{ x: number; y: number }>> = {
  engineering: [{ x: 24, y: 36 }, { x: 32, y: 36 }, { x: 24, y: 42 }, { x: 32, y: 42 }],
  product:     [{ x: 54, y: 36 }, { x: 62, y: 36 }, { x: 54, y: 42 }, { x: 62, y: 42 }],
  operations:  [{ x: 24, y: 64 }, { x: 32, y: 64 }, { x: 24, y: 70 }, { x: 32, y: 70 }],
  research:    [{ x: 50, y: 64 }, { x: 58, y: 64 }, { x: 50, y: 70 }, { x: 58, y: 70 }],
  quality:     [{ x: 58, y: 64 }, { x: 66, y: 64 }, { x: 58, y: 70 }, { x: 66, y: 70 }],
  general:     [{ x: 38, y: 45 }, { x: 46, y: 39 }, { x: 54, y: 45 }, { x: 62, y: 39 }, { x: 42, y: 52 }, { x: 58, y: 52 }],
}

const FALLBACK_BY_ZONE: Record<string, string[]> = {
  engineering: ['operations', 'general'],
  product: ['research', 'general'],
  operations: ['engineering', 'general'],
  research: ['product', 'general'],
  quality: ['research', 'general'],
  general: ['general'],
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseOfficeSeatMapInput {
  visibleDisplayAgents: Agent[]
  movingWorkers: MovingWorker[]
  agentActionOverrides: Map<number, OfficeAction>
  sidebarFilter: SidebarFilter
  isLocalMode: boolean
}

interface UseOfficeSeatMapResult {
  officeLayout: ReturnType<typeof buildOfficeLayout>
  currentSeatMap: Map<number, SeatPosition>
  gameWorkers: Array<{ agent: Agent; x: number; y: number; zoneLabel: string; seatLabel: string }>
  renderedWorkers: RenderedWorker[]
  floorTiles: FloorTile[]
  nightSparkles: NightSparkle[]
  heatmapPoints: HeatmapPoint[]
  pathEdges: PathEdge[]
  rosterRows: RosterRow[]
  filteredRosterRows: RosterRow[]
}

export function useOfficeSeatMap({
  visibleDisplayAgents,
  movingWorkers,
  agentActionOverrides,
  sidebarFilter,
  isLocalMode,
}: UseOfficeSeatMapInput): UseOfficeSeatMapResult {
  const officeLayout = useMemo(() => buildOfficeLayout(visibleDisplayAgents), [visibleDisplayAgents])

  const currentSeatMap = useMemo(() => {
    const seatMap = new Map<number, SeatPosition>()
    const usageByZone = new Map<string, number>()
    const pullSeat = (zoneId: string) => {
      const templates = ZONE_SEAT_TEMPLATES[zoneId] || ZONE_SEAT_TEMPLATES.general
      const used = usageByZone.get(zoneId) || 0
      const chosen = templates[used % templates.length] || { x: 38, y: 47 }
      const overflowBand = Math.floor(used / templates.length)
      usageByZone.set(zoneId, used + 1)
      return { x: chosen.x, y: chosen.y + overflowBand * 3.5 }
    }
    for (const zoneEntry of officeLayout) {
      const zone = zoneEntry.zone
      const sortedWorkers = [...zoneEntry.workers].sort((a, b) => a.agent.name.localeCompare(b.agent.name))
      for (const worker of sortedWorkers) {
        const primaryTemplates = ZONE_SEAT_TEMPLATES[zone.id] || ZONE_SEAT_TEMPLATES.general
        const primaryUsed = usageByZone.get(zone.id) || 0
        const inPrimaryCapacity = primaryUsed < primaryTemplates.length * 2
        const targetZone = inPrimaryCapacity ? zone.id : (FALLBACK_BY_ZONE[zone.id] || ['general'])[0]
        const seat = pullSeat(targetZone)
        seatMap.set(worker.agent.id, {
          seatKey: `${targetZone}:${worker.anchor.seatLabel}`,
          x: clamp(seat.x, 8, 92),
          y: clamp(seat.y, 12, 92),
        })
      }
    }
    return seatMap
  }, [officeLayout])

  const gameWorkers = useMemo(() => {
    const workers: Array<{ agent: Agent; x: number; y: number; zoneLabel: string; seatLabel: string }> = []
    for (const zone of officeLayout) {
      for (const worker of zone.workers) {
        const seat = currentSeatMap.get(worker.agent.id)
        if (!seat) continue
        workers.push({ agent: worker.agent, x: seat.x, y: seat.y, zoneLabel: zone.zone.label, seatLabel: worker.anchor.seatLabel })
      }
    }
    return workers
  }, [currentSeatMap, officeLayout])

  const movingPositionByAgent = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>()
    for (const worker of movingWorkers) {
      positions.set(worker.agentId, pointAlongPath(worker.path, worker.pathLengths, worker.totalLength, easeInOut(worker.progress)))
    }
    return positions
  }, [movingWorkers])

  const movingDirectionByAgent = useMemo(() => {
    const directions = new Map<number, { dx: number; dy: number }>()
    for (const worker of movingWorkers) {
      directions.set(worker.agentId, { dx: worker.endX - worker.startX, dy: worker.endY - worker.startY })
    }
    return directions
  }, [movingWorkers])

  const renderedWorkers = useMemo<RenderedWorker[]>(() => {
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

  const floorTiles = useMemo<FloorTile[]>(() => {
    const tiles: FloorTile[] = []
    const tileW = 100 / MAP_COLS
    const tileH = 100 / MAP_ROWS
    for (let row = 0; row < MAP_ROWS; row += 1) {
      for (let col = 0; col < MAP_COLS; col += 1) {
        tiles.push({ id: `tile-${row}-${col}`, x: col * tileW, y: row * tileH, w: tileW, h: tileH, sprite: (row + col) % 2 === 0 })
      }
    }
    return tiles
  }, [])

  const nightSparkles = useMemo<NightSparkle[]>(
    () => Array.from({ length: 14 }, (_, idx) => {
      const seed = hashNumber(`night-${idx}`)
      return { id: idx, x: 6 + (seed % 88), y: 6 + ((seed >> 3) % 38), delay: (seed % 7) * 0.4, size: 2 + (seed % 3) }
    }),
    [],
  )

  const heatmapPoints = useMemo<HeatmapPoint[]>(() => {
    return renderedWorkers.map((worker) => {
      const action = agentActionOverrides.get(worker.agent.id)
      let intensity = worker.agent.status === 'busy' ? 0.95 : worker.agent.status === 'idle' ? 0.45 : 0.7
      if (action === 'focus') intensity += 0.25
      if (action === 'pair') intensity += 0.15
      if (worker.isMoving) intensity += 0.2
      const radius = worker.agent.status === 'busy' ? 14 : 10
      const hue = worker.agent.status === 'busy' ? 'rgba(255,191,84,' : worker.agent.status === 'idle' ? 'rgba(88,220,139,' : 'rgba(120,189,255,'
      return { id: worker.agent.id, x: worker.x, y: worker.y, radius, color: `${hue}${Math.min(0.85, Math.max(0.2, intensity)).toFixed(2)})` }
    })
  }, [agentActionOverrides, renderedWorkers])

  const pathEdges = useMemo<PathEdge[]>(() => {
    const edges: PathEdge[] = []
    const zoneGroups = new Map<string, Array<{ x: number; y: number }>>()
    for (const worker of gameWorkers) {
      if (!zoneGroups.has(worker.zoneLabel)) zoneGroups.set(worker.zoneLabel, [])
      zoneGroups.get(worker.zoneLabel)!.push({ x: worker.x, y: worker.y })
    }
    for (const points of zoneGroups.values()) {
      const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
      for (let i = 0; i < sorted.length - 1; i += 1) {
        edges.push({ x1: sorted[i].x, y1: sorted[i].y + 2, x2: sorted[i + 1].x, y2: sorted[i + 1].y + 2 })
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

  const rosterRows = useMemo<RosterRow[]>(() => {
    return gameWorkers.map(({ agent }) => {
      const minutesIdle = agent.last_seen ? Math.floor((Date.now() / 1000 - agent.last_seen) / 60) : Number.POSITIVE_INFINITY
      return { agent, minutesIdle, needsAttention: isLocalMode && agent.status === 'idle' && minutesIdle >= 15 }
    })
  }, [gameWorkers, isLocalMode])

  const filteredRosterRows = useMemo<RosterRow[]>(() => {
    if (sidebarFilter === 'all') return rosterRows
    if (sidebarFilter === 'working') return rosterRows.filter((row) => row.agent.status === 'busy')
    if (sidebarFilter === 'idle') return rosterRows.filter((row) => row.agent.status === 'idle')
    return rosterRows.filter((row) => row.needsAttention)
  }, [rosterRows, sidebarFilter])

  return {
    officeLayout,
    currentSeatMap,
    gameWorkers,
    renderedWorkers,
    floorTiles,
    nightSparkles,
    heatmapPoints,
    pathEdges,
    rosterRows,
    filteredRosterRows,
  }
}
