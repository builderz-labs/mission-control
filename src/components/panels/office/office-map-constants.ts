// Map layout constants and pathfinding infrastructure for the office panel.
// All exported values are immutable — callers must spread before mutating state copies.

import type { MapProp, MapRoom, WorkerVariant } from './office-types'

// Inlined to avoid circular dependency with office-utils (which imports WORKER_VARIANTS from here).
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ─── Grid dimensions ──────────────────────────────────────────────────────────

export const MAP_COLS = 24
export const MAP_ROWS = 16

// ─── Default room and prop layouts ───────────────────────────────────────────

export const ROOM_LAYOUT: readonly MapRoom[] = [
  { id: 'eng',     label: 'Engine Bay',    x: 16, y: 22, w: 28, h: 22, style: 'bg-[#0c1628]' },
  { id: 'product', label: 'Bridge',        x: 48, y: 22, w: 24, h: 22, style: 'bg-[#0a1a2a]' },
  { id: 'ops',     label: 'Ops Deck',      x: 16, y: 49, w: 24, h: 24, style: 'bg-[#10132a]' },
  { id: 'research',label: 'Lab',           x: 44, y: 49, w: 22, h: 24, style: 'bg-[#0d1526]' },
  { id: 'lounge',  label: 'Crew Quarters', x: 70, y: 49, w: 16, h: 24, style: 'bg-[#0c1a1a]' },
]

export const MAP_PROPS: readonly MapProp[] = [
  { id: 'desk-a', x: 22, y: 30, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-b', x: 33, y: 30, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-c', x: 52, y: 30, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-d', x: 61, y: 30, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-e', x: 22, y: 58, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-f', x: 31, y: 58, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-g', x: 48, y: 58, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'desk-h', x: 57, y: 58, w: 8,  h: 2.8, style: 'bg-[#0f1c30]', border: 'border-void-cyan/25' },
  { id: 'plant-l',x: 14, y: 47, w: 3,  h: 5,   style: 'bg-void-mint/30', border: 'border-void-mint/20' },
  { id: 'plant-r',x: 84, y: 47, w: 3,  h: 5,   style: 'bg-void-mint/30', border: 'border-void-mint/20' },
  { id: 'kitchen',x: 72, y: 57, w: 12, h: 10,  style: 'bg-[#0c1a1a]', border: 'border-void-mint/20' },
]

// Waypoints idle agents wander towards when taking a break.
export const LOUNGE_WAYPOINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 74, y: 60 },
  { x: 79, y: 60 },
  { x: 82, y: 66 },
  { x: 76, y: 68 },
]

// ─── Worker appearance variants ───────────────────────────────────────────────

export const WORKER_VARIANTS: readonly WorkerVariant[] = [
  { id: 'default', filter: 'none',                              accent: 'border-cyan-300/60' },
  { id: 'warm',    filter: 'hue-rotate(18deg) saturate(1.08)', accent: 'border-amber-300/60' },
  { id: 'cool',    filter: 'hue-rotate(-20deg) saturate(1.1)', accent: 'border-sky-300/60' },
  { id: 'mint',    filter: 'hue-rotate(42deg) saturate(1.08)', accent: 'border-emerald-300/60' },
  { id: 'violet',  filter: 'hue-rotate(64deg) saturate(1.12)', accent: 'border-violet-300/60' },
]

// ─── Pathfinding ──────────────────────────────────────────────────────────────

export function toTile(xPercent: number, yPercent: number): { col: number; row: number } {
  const col = clamp(Math.round((xPercent / 100) * (MAP_COLS - 1)), 0, MAP_COLS - 1)
  const row = clamp(Math.round((yPercent / 100) * (MAP_ROWS - 1)), 0, MAP_ROWS - 1)
  return { col, row }
}

export function tileToPercent(col: number, row: number): { x: number; y: number } {
  const x = (col / (MAP_COLS - 1)) * 100
  const y = (row / (MAP_ROWS - 1)) * 100
  return { x, y }
}

export function tileKey(col: number, row: number): string {
  return `${col},${row}`
}

function buildWalkabilityGrid(): boolean[][] {
  const walkable: boolean[][] = Array.from(
    { length: MAP_ROWS },
    () => Array.from({ length: MAP_COLS }, () => true),
  )

  // Border walls — agents cannot walk off the map edge.
  for (let r = 0; r < MAP_ROWS; r += 1) {
    walkable[r][0] = false
    walkable[r][MAP_COLS - 1] = false
  }
  for (let c = 0; c < MAP_COLS; c += 1) {
    walkable[0][c] = false
    walkable[MAP_ROWS - 1][c] = false
  }

  // Static furniture obstacles push routes into corridor lanes.
  const obstacleRects = [
    { c1: 5, c2: 8,  r1: 4, r2: 5 },
    { c1: 9, c2: 12, r1: 4, r2: 5 },
    { c1: 13, c2: 16, r1: 4, r2: 5 },
    { c1: 17, c2: 20, r1: 4, r2: 5 },
    { c1: 5,  c2: 8,  r1: 9, r2: 10 },
    { c1: 9,  c2: 12, r1: 9, r2: 10 },
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

  // Keep central horizontal corridor always traversable.
  const corridorRow = 7
  for (let c = 1; c < MAP_COLS - 1; c += 1) walkable[corridorRow][c] = true
  return walkable
}

function findGridPath(
  start: { col: number; row: number },
  end: { col: number; row: number },
  walkable: boolean[][],
): Array<{ col: number; row: number }> {
  const inBounds = (col: number, row: number) =>
    row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS
  const key = (col: number, row: number) => `${col},${row}`
  const parse = (k: string) => {
    const [c, r] = k.split(',').map(Number)
    return { col: c, row: r }
  }

  const open = new Set<string>([key(start.col, start.row)])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[key(start.col, start.row), 0]])
  const fScore = new Map<string, number>([
    [key(start.col, start.row), Math.abs(start.col - end.col) + Math.abs(start.row - end.row)],
  ])

  while (open.size > 0) {
    let currentKey = ''
    let lowest = Number.POSITIVE_INFINITY
    for (const k of open) {
      const f = fScore.get(k) ?? Number.POSITIVE_INFINITY
      if (f < lowest) { lowest = f; currentKey = k }
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
      { col: current.col,     row: current.row + 1 },
      { col: current.col,     row: current.row - 1 },
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

export interface PathResult {
  path: Array<{ x: number; y: number }>
  pathLengths: number[]
  totalLength: number
}

export function buildPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  blockedTiles: Set<string> = new Set(),
): PathResult {
  const walkable = buildWalkabilityGrid()
  const startTile = toTile(startX, startY)
  const endTile = toTile(endX, endY)

  for (const tile of blockedTiles) {
    const [col, row] = tile.split(',').map(Number)
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) continue
    walkable[row][col] = false
  }
  // Start/end must always be traversable even if blocked by another agent.
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

export function pointAlongPath(
  path: ReadonlyArray<{ x: number; y: number }>,
  pathLengths: number[],
  totalLength: number,
  progress: number,
): { x: number; y: number } {
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
