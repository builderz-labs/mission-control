import {
  BOARD_COLS,
  clampItem,
  emptyBoard,
  migrateLegacyLayout,
  type BoardItem,
  type BoardState,
  type WidgetSize,
} from '@/lib/dashboard-board'

export const BOARD_STORAGE_KEY = 'mc-dashboard-board-v1'
export const LEGACY_LAYOUT_KEY = 'mc-dashboard-layout'
export const BOARD_SETTING_KEY = 'dashboard.board_v1'
export const MAX_BOARD_BYTES = 32 * 1024

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function isItem(value: unknown): value is BoardItem {
  if (!value || typeof value !== 'object') return false
  const item = value as BoardItem
  return (item.kind === 'widget' || item.kind === 'session')
    && typeof item.id === 'string'
    && item.id.length > 0
    && Number.isFinite(item.x)
    && Number.isFinite(item.y)
    && Number.isFinite(item.w)
    && Number.isFinite(item.h)
}

export function parseBoardJson(raw: unknown): BoardState | null {
  if (typeof raw === 'string') {
    if (utf8Bytes(raw) > MAX_BOARD_BYTES) return null
    try {
      return parseBoardJson(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as BoardState
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) return null
  const items = candidate.items.filter(isItem).map((item) => clampItem(item))
  return { version: 1, cols: BOARD_COLS, items }
}

export function serializeBoard(board: BoardState): string {
  const json = JSON.stringify(board)
  if (utf8Bytes(json) > MAX_BOARD_BYTES) {
    throw new Error('dashboard board exceeds 32KB')
  }
  return json
}

export function readLocalBoard(
  storage: Pick<Storage, 'getItem'> | null,
  sizeFor: (catalogId: string) => WidgetSize = () => 'md',
): BoardState | null {
  if (!storage) return null
  const modern = parseBoardJson(storage.getItem(BOARD_STORAGE_KEY))
  if (modern) return modern
  const legacyRaw = storage.getItem(LEGACY_LAYOUT_KEY)
  if (!legacyRaw) return null
  try {
    const ids = JSON.parse(legacyRaw) as unknown
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null
    return migrateLegacyLayout(ids, sizeFor)
  } catch {
    return null
  }
}

export function writeLocalBoard(storage: Pick<Storage, 'setItem'> | null, board: BoardState): void {
  if (!storage) return
  storage.setItem(BOARD_STORAGE_KEY, serializeBoard(board))
}

export function emptyOr(board: BoardState | null): BoardState {
  return board ?? emptyBoard()
}
