export const BOARD_COLS = 12
export const MIN_W = 3
export const MAX_H = 4
export const ALLOWED_W = [3, 4, 6, 8, 12] as const
export const SESSION_MIME = 'application/x-mc-session'

export type BoardItemKind = 'widget' | 'session'

export interface BoardItem {
  id: string
  kind: BoardItemKind
  x: number
  y: number
  w: number
  h: number
  pinned?: boolean
}

export interface BoardState {
  version: 1
  cols: typeof BOARD_COLS
  items: BoardItem[]
}

export type WidgetSize = 'sm' | 'md' | 'lg' | 'full'

export function widgetTileId(catalogId: string): string {
  return `widget:${catalogId}`
}

export function sessionTileId(sessionId: string): string {
  return `session:${sessionId}`
}

export function parseTileId(id: string): { kind: BoardItemKind; ref: string } | null {
  if (id.startsWith('widget:')) return { kind: 'widget', ref: id.slice(7) }
  if (id.startsWith('session:')) return { kind: 'session', ref: id.slice(8) }
  return null
}

export function sizeToSpan(size: WidgetSize): { w: number; h: number } {
  if (size === 'sm') return { w: 6, h: 2 }
  if (size === 'lg') return { w: 8, h: 2 }
  if (size === 'full') return { w: 12, h: 1 }
  return { w: 4, h: 2 }
}

export function emptyBoard(): BoardState {
  return { version: 1, cols: BOARD_COLS, items: [] }
}

export function clampItem(item: BoardItem, cols = BOARD_COLS): BoardItem {
  const w = ALLOWED_W.includes(item.w as typeof ALLOWED_W[number])
    ? item.w
    : ALLOWED_W.reduce((best, n) => Math.abs(n - item.w) < Math.abs(best - item.w) ? n : best, 4)
  const h = Math.max(1, Math.min(MAX_H, Math.round(item.h) || 1))
  const x = Math.max(0, Math.min(cols - w, Math.round(item.x) || 0))
  const y = Math.max(0, Math.round(item.y) || 0)
  return { ...item, x, y, w, h }
}

function overlaps(a: BoardItem, b: BoardItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function canPlace(items: BoardItem[], candidate: BoardItem, ignoreId?: string): boolean {
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.w > BOARD_COLS) return false
  return items.every((item) => item.id === ignoreId || !overlaps(item, candidate))
}

export function firstFit(items: BoardItem[], w: number, h: number, ignoreId?: string): { x: number; y: number } {
  const maxY = items.reduce((m, item) => Math.max(m, item.y + item.h), 0)
  for (let y = 0; y <= maxY + 1; y += 1) {
    for (let x = 0; x <= BOARD_COLS - w; x += 1) {
      if (canPlace(items, { id: '_', kind: 'widget', x, y, w, h }, ignoreId)) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: maxY }
}

export function compactUp(board: BoardState): BoardState {
  const sorted = [...board.items].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: BoardItem[] = []
  for (const item of sorted) {
    let next = { ...item }
    while (next.y > 0 && canPlace(placed, { ...next, y: next.y - 1 }, item.id)) {
      next = { ...next, y: next.y - 1 }
    }
    placed.push(next)
  }
  return { ...board, items: placed }
}

export function migrateLegacyLayout(
  ids: string[],
  sizeFor: (catalogId: string) => WidgetSize = () => 'md',
): BoardState {
  let items: BoardItem[] = []
  for (const catalogId of ids) {
    const span = sizeToSpan(sizeFor(catalogId))
    const pos = firstFit(items, span.w, span.h)
    items = [...items, { id: widgetTileId(catalogId), kind: 'widget', ...pos, ...span }]
  }
  return compactUp({ version: 1, cols: BOARD_COLS, items })
}

export function packItem(board: BoardState, item: BoardItem): BoardState {
  if (board.items.some((entry) => entry.id === item.id)) return board
  const sized = clampItem({ ...item, ...firstFit(board.items, clampItem(item).w, clampItem(item).h) })
  return { ...board, items: [...board.items, sized] }
}

export function moveItem(board: BoardState, id: string, x: number, y: number): BoardState {
  const current = board.items.find((item) => item.id === id)
  if (!current) return board
  const moved = clampItem({ ...current, x, y })
  const others = board.items.filter((item) => item.id !== id)
  const pushed = others.map((item) => {
    if (!overlaps(item, moved)) return item
    return { ...item, y: moved.y + moved.h }
  })
  return compactUp({ ...board, items: [...pushed, moved] })
}

export function resizeItem(board: BoardState, id: string, w: number, h: number): BoardState {
  const current = board.items.find((item) => item.id === id)
  if (!current) return board
  const resized = clampItem({ ...current, w, h })
  const others = board.items.filter((item) => item.id !== id)
  const pos = canPlace(others, resized, id) ? { x: resized.x, y: resized.y } : firstFit(others, resized.w, resized.h, id)
  return compactUp({ ...board, items: [...others, { ...resized, ...pos }] })
}

export function removeItem(board: BoardState, id: string): BoardState {
  return compactUp({ ...board, items: board.items.filter((item) => item.id !== id) })
}

export function pinItem(board: BoardState, id: string, pinned: boolean): BoardState {
  return {
    ...board,
    items: board.items.map((item) => item.id === id ? { ...item, pinned } : item),
  }
}

export function syncLiveSessions(board: BoardState, activeSessionIds: string[]): BoardState {
  const active = new Set(activeSessionIds)
  let items = board.items.filter((item) => {
    if (item.kind !== 'session') return true
    const ref = parseTileId(item.id)?.ref
    return Boolean(ref && (active.has(ref) || item.pinned))
  })
  for (const sessionId of activeSessionIds) {
    const id = sessionTileId(sessionId)
    if (items.some((item) => item.id === id)) continue
    const pos = firstFit(items, 4, 2)
    items = [...items, { id, kind: 'session', x: pos.x, y: pos.y, w: 4, h: 2 }]
  }
  return { ...board, items }
}
